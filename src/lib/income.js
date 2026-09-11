// Dividends, costs, interest and lending income by period and by instrument.
//
// Everything here comes from the raw rows, never from engine output (rule 2): the
// engine's arrays are a cache, and a tax figure is not allowed to depend on one.
// No network, no browser API, no store, no clock. Nothing is rounded.

/** The tax names the adapter sums into `Trade.fees`, so a cost is never counted
 *  twice: `fees` already holds them, `taxes` reports them by name. */
const FEE_TAX_NAMES = new Set([
  'COMMISSION_TURNOVER',
  'TRANSACTION_FEE',
  'CURRENCY_CONVERSION_FEE',
  'FINRA_FEE',
  'PTM_LEVY',
]);

/** The tax name Trading 212 uses for the cost of turning one currency into
 *  another. US-04 AC3: it is its own cost category and never part of a rate. */
const FX_FEE_NAME = 'CURRENCY_CONVERSION_FEE';

/** Payouts that are a share of profit. Interest on cash is income too, but it is
 *  not a dividend and is reported under `interest`. An unrecognised payout is
 *  credited as a dividend and counted as unknown by the engine (rule 4). */
const DIVIDEND_CATEGORIES = new Set(['DIVIDEND', 'MANUFACTURED', 'RETURN_OF_CAPITAL', 'UNKNOWN']);

/** Interest charged rather than earned, per bucket. Kept beside the buckets so a
 *  returned bucket carries only the fields its typedef names. */
function makeCharged() {
  const charged = new Map();
  return {
    add(bucket, amount) {
      charged.set(bucket, (charged.get(bucket) ?? 0) + amount);
    },
    of(bucket) {
      return charged.get(bucket) ?? 0;
    },
  };
}

function emptyBucket() {
  return {
    dividend: { gross: 0, withheld: 0, net: 0, count: 0 },
    fees: 0,
    taxes: {},
    fxFees: 0,
    interest: 0,
    lending: 0,
    totalCost: 0,
  };
}

function num(value) {
  return Number.isFinite(value) ? value : 0;
}

/** @param {string} date @returns {boolean} */
function inRange(date, from, to) {
  if (typeof date !== 'string') return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** Sorts a keyed set so the output order never depends on input order. */
function sortKeys(record) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key];
  return out;
}

/**
 * Dividend and cost totals for a window, split three ways: per instrument, per
 * month (`YYYY-MM`) and per year (`YYYY`). `from` and `to` are inclusive; either
 * may be null for an open end. Cash rows carry no instrument, so fees, interest
 * and lending taken from them appear in the total and the period buckets only.
 *
 * @param {{ dividends?:import('./types.js').Dividend[],
 *   trades?:import('./types.js').Trade[],
 *   cashRows?:import('./types.js').CashRow[] }} raw
 * @param {{ from?:string|null, to?:string|null }} [window]
 * @returns {import('./types.js').IncomeSummary}
 */
export function summarise(raw, { from = null, to = null } = {}) {
  const { dividends = [], trades = [], cashRows = [] } = raw ?? {};
  const total = emptyBucket();
  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const byInstrument = {};
  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const byMonth = {};
  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const byYear = {};
  const charged = makeCharged();

  /** The buckets a row belongs to: the total, its month, its year, and its
   * instrument when it has one. */
  const bucketsFor = (date, ticker) => {
    const month = date.slice(0, 7);
    const year = date.slice(0, 4);
    if (!byMonth[month]) byMonth[month] = emptyBucket();
    if (!byYear[year]) byYear[year] = emptyBucket();
    const out = [total, byMonth[month], byYear[year]];
    if (ticker) {
      if (!byInstrument[ticker]) byInstrument[ticker] = emptyBucket();
      out.push(byInstrument[ticker]);
    }
    return out;
  };

  for (const dividend of dividends) {
    if (!inRange(dividend.date, from, to)) continue;
    const net = num(dividend.net);
    for (const bucket of bucketsFor(dividend.date, dividend.ticker ?? null)) {
      if (DIVIDEND_CATEGORIES.has(dividend.category)) {
        bucket.dividend.gross += num(dividend.gross);
        bucket.dividend.withheld += num(dividend.withheld);
        bucket.dividend.net += net;
        bucket.dividend.count += 1;
      } else if (dividend.category === 'INTEREST') {
        bucket.interest += net;
        if (net < 0) charged.add(bucket, -net);
      }
    }
  }

  for (const trade of trades) {
    if (!inRange(trade.date, from, to)) continue;
    // A corporate action moves quantity and no cash (types.js Trade.kind); its
    // `taxes` are not already folded into any `fees` total the way a TRADE's are
    // (the adapter always reports `fees: 0` for one), so counting them here would
    // report a cost the cash and pnl arrays never actually paid.
    if (trade.kind === 'CORPORATE_ACTION') continue;
    const taxes = Array.isArray(trade.taxes) ? trade.taxes : [];
    for (const bucket of bucketsFor(trade.date, trade.ticker ?? null)) {
      bucket.fees += num(trade.fees);
      for (const tax of taxes) {
        if (!tax || !tax.name || !Number.isFinite(tax.amount)) continue;
        bucket.taxes[tax.name] = num(bucket.taxes[tax.name]) + tax.amount;
        if (tax.name === FX_FEE_NAME) bucket.fxFees += tax.amount;
      }
    }
  }

  for (const row of cashRows) {
    if (!inRange(row.date, from, to)) continue;
    if (row.category === 'UNKNOWN' || !Number.isFinite(row.amount)) continue;
    for (const bucket of bucketsFor(row.date, null)) {
      if (row.category === 'FEE') {
        // A fee row is money out, stated negative; a cost is stated positive.
        bucket.fees += -row.amount;
      } else if (row.category === 'INTEREST') {
        bucket.interest += row.amount;
        if (row.amount < 0) charged.add(bucket, -row.amount);
      } else if (row.category === 'LENDING') {
        bucket.lending += row.amount;
      }
    }
  }

  const buckets = [total, ...Object.values(byInstrument), ...Object.values(byMonth),
    ...Object.values(byYear)];
  for (const bucket of buckets) {
    let extraTaxes = 0;
    for (const [name, amount] of Object.entries(bucket.taxes)) {
      if (!FEE_TAX_NAMES.has(name)) extraTaxes += amount;
    }
    bucket.taxes = sortKeys(bucket.taxes);
    // What left the account: trade fees, the taxes those fees do not already
    // cover, the tax withheld from dividends, and interest charged not earned.
    bucket.totalCost = bucket.fees + extraTaxes + bucket.dividend.withheld + charged.of(bucket);
  }

  return {
    from,
    to,
    total,
    byInstrument: sortKeys(byInstrument),
    byMonth: sortKeys(byMonth),
    byYear: sortKeys(byYear),
  };
}
