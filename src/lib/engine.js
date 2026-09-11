// The daily portfolio history: what the account was worth on every day, how much
// of that was paid in, and what the rest of it did.
//
// This module is pure. Plain arrays in, plain arrays out. It may not make network
// requests, touch a browser API, read a store, read the clock or log anything;
// `today` is a parameter. Every number it returns is a cache that can be deleted
// and rebuilt from the raw rows (rule 2). Nothing is rounded here: rounding
// happens once, in the UI formatter.

import { daysBetween, range, toISODate } from './dates.js';

/** A quantity nearer zero than this is zero: fractional shares are exact to far
 *  fewer digits than this. */
const QTY_EPS = 1e-9;

/** A stated exchange rate may differ from the settled amount by this much before
 *  we stop believing it. */
const FX_DISAGREE = 0.005;

/** The tax names the adapter already sums into `Trade.fees` (BUILD-PLAN,
 *  `parseOrders`). They stay in `taxes[]` for the income module, so the cash
 *  identity below must not subtract them a second time. */
const FEE_TAX_NAMES = new Set([
  'COMMISSION_TURNOVER',
  'TRANSACTION_FEE',
  'CURRENCY_CONVERSION_FEE',
  'FINRA_FEE',
  'PTM_LEVY',
]);

/** A payout that is a share of profit, as opposed to interest paid on cash. Only
 *  these feed the dividend arrays; interest is income, not a dividend. */
const DIVIDEND_CATEGORIES = new Set(['DIVIDEND', 'MANUFACTURED', 'RETURN_OF_CAPITAL']);

/** Emitted warnings appear in this order, so the same input always produces the
 *  same output array. */
const WARNING_ORDER = [
  'UNKNOWN_INSTRUMENT',
  'PRICE_SERIES_MISSING',
  'FX_NO_RATE',
  'FX_DERIVED',
  'CASH_UNKNOWN',
  'TX_FOREIGN_CURRENCY',
  'DIVIDEND_TYPE_UNKNOWN',
  'CORPORATE_ACTION_CASH',
  'QUANTITY_NEGATIVE',
  'ESTIMATED_DAYS',
];

/**
 * The exchange rate convention, used everywhere below.
 *
 * `fxRate` is the number of units of the instrument currency that one unit of the
 * account currency buys, which is the form Trading 212 states on a fill. So
 *
 *     value_account = quantity * price_instrumentCurrency / fxRate
 *
 * and the account currency itself always has rate 1. A stated rate of exactly 1
 * for any other currency is not a measurement, it is a default, and is treated as
 * absent. When the rate is absent, or disagrees with the money that actually moved
 * by more than 0.5%, it is derived from the fill instead:
 *
 *     fxRate = |price * quantity| / |settled|
 *
 * which is the rate that makes the trade-day value equal the settled amount
 * exactly. `settled` excludes fees and taxes; the adapter guarantees that, and the
 * cash identity below subtracts both separately.
 */

/** @param {{date:string, id?:string}} a @param {{date:string, id?:string}} b */
function byDateAndId(a, b) {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  const left = String(a.id ?? '');
  const right = String(b.id ?? '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function makeWarnings() {
  /** @type {Map<string, {count:number, details:string[]}>} */
  const rows = new Map();
  return {
    /** @param {string} code @param {number} [count] @param {string} [detail] */
    bump(code, count = 1, detail) {
      const row = rows.get(code) ?? { count: 0, details: [] };
      row.count += count;
      if (detail !== undefined && !row.details.includes(detail)) row.details.push(detail);
      rows.set(code, row);
    },
    list() {
      const codes = [
        ...WARNING_ORDER.filter((code) => rows.has(code)),
        ...[...rows.keys()].filter((code) => !WARNING_ORDER.includes(code)).sort(),
      ];
      return codes.map((code) => {
        const row = rows.get(code);
        const out = { code, count: row.count };
        if (row.details.length) out.detail = row.details.join(', ');
        return out;
      });
    },
  };
}

/** The stated rate, or null when it is absent or is the 1 that means nothing.
 * @param {{fxRate:number|null, priceCurrency:string}} trade @param {string} baseCurrency */
function statedRate(trade, baseCurrency) {
  const stated = trade.fxRate;
  if (!Number.isFinite(stated) || stated <= 0) return null;
  if (stated === 1 && trade.priceCurrency !== baseCurrency) return null;
  return stated;
}

/** One measured rate for the day of this fill, or null when the fill cannot yield
 * one. Counts a disagreement under FX_DERIVED. */
function ratePoint(trade, baseCurrency, warnings) {
  const gross = Math.abs(trade.price * trade.quantity);
  const settled = Math.abs(trade.settled);
  const derived = gross > 0 && settled > 0 ? gross / settled : null;
  const stated = statedRate(trade, baseCurrency);
  if (stated === null) return derived;
  if (derived !== null && Math.abs(derived - stated) / stated > FX_DISAGREE) {
    warnings.bump('FX_DERIVED');
    return derived;
  }
  return stated;
}

/** Day-indexed rate for one currency from its measured points: the most recent
 * point on or before the day, linear interpolation between two points, and the
 * nearest point outside the measured span. Only a day that has a point of its own
 * is measured. */
function fxSeries(points, days) {
  const rate = new Array(days.length);
  const measured = new Array(days.length);
  const last = points[points.length - 1];
  let k = 0;
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i];
    while (k + 1 < points.length && points[k + 1].date <= day) k += 1;
    if (day < points[0].date) {
      rate[i] = points[0].rate;
      measured[i] = false;
    } else if (points[k].date === day) {
      rate[i] = points[k].rate;
      measured[i] = true;
    } else if (day > last.date) {
      rate[i] = last.rate;
      measured[i] = false;
    } else {
      const from = points[k];
      const to = points[k + 1];
      const span = daysBetween(from.date, to.date);
      const step = daysBetween(from.date, day);
      rate[i] = from.rate + ((to.rate - from.rate) * step) / span;
      measured[i] = false;
    }
  }
  return { rate, measured };
}

/** Closes keyed by the UTC day the candle falls in; the last candle of a day wins. */
function closesByDay(series) {
  const candles = series && Array.isArray(series.candles) ? series.candles : [];
  const closes = new Map();
  const sorted = [...candles].sort((a, b) => a[0] - b[0]);
  for (const candle of sorted) {
    if (!Array.isArray(candle)) continue;
    if (!Number.isFinite(candle[0]) || !Number.isFinite(candle[4])) continue;
    closes.set(toISODate(candle[0]), candle[4]);
  }
  return closes;
}

/** The taxes on a fill that `Trade.fees` does not already contain. Subtracting
 * both `fees` and every tax would charge the fee taxes twice. */
function extraTaxTotal(trade) {
  const taxes = Array.isArray(trade.taxes) ? trade.taxes : [];
  let total = 0;
  for (const tax of taxes) {
    if (!Number.isFinite(tax?.amount)) continue;
    if (FEE_TAX_NAMES.has(tax.name)) continue;
    total += tax.amount;
  }
  return total;
}

/** Every tax on a fill, used only to check that a corporate action moved no cash. */
function taxTotal(trade) {
  const taxes = Array.isArray(trade.taxes) ? trade.taxes : [];
  let total = 0;
  for (const tax of taxes) if (Number.isFinite(tax?.amount)) total += tax.amount;
  return total;
}

/** A corporate action moves quantity and no cash. One that states an amount is a
 * shape we do not understand, so it is still treated as cash-neutral and counted. */
function corporateActionIsCashNeutral(trade) {
  const fees = Number.isFinite(trade.fees) ? trade.fees : 0;
  const settled = Number.isFinite(trade.settled) ? trade.settled : 0;
  return Math.round(settled * 100) === 0
    && Math.round(fees * 100) === 0
    && Math.round(taxTotal(trade) * 100) === 0;
}

/** The days the history covers: from the earliest row to `today`, extended when a
 * row is dated later than `today` so that no row is silently dropped. */
function dayRange(sets, today) {
  let first = null;
  let latest = null;
  for (const rows of sets) {
    if (!rows.length) continue;
    const from = rows[0].date;
    const to = rows[rows.length - 1].date;
    if (first === null || from < first) first = from;
    if (latest === null || to > latest) latest = to;
  }
  if (first === null) return [];
  return range(first, latest > today ? latest : today);
}

function emptyResult(baseCurrency) {
  return {
    days: [],
    value: [],
    positionsValue: [],
    cash: [],
    netExternal: [],
    paidIn: [],
    pnl: [],
    dividendGross: [],
    dividendWithheld: [],
    estimated: [],
    dividendEstimated: [],
    byInstrument: {},
    fx: {},
    positionsToday: {},
    warnings: [],
    baseCurrency,
  };
}

/**
 * @param {{ trades:import('./types.js').Trade[],
 *   dividends:import('./types.js').Dividend[],
 *   cashRows:import('./types.js').CashRow[],
 *   instruments:Record<string, import('./types.js').Instrument>,
 *   prices:Record<string, import('./types.js').PriceSeries>,
 *   today:import('./types.js').ISODate, baseCurrency:string }} input
 * @returns {import('./types.js').PortfolioResult}
 */
export function computePortfolio(input) {
  const {
    trades: tradesIn = [],
    dividends: dividendsIn = [],
    cashRows: cashIn = [],
    instruments = {},
    prices = {},
    today,
    baseCurrency,
  } = input ?? {};

  // Determinism: sort every input array by (date, id) before use.
  const trades = [...tradesIn].sort(byDateAndId);
  const dividends = [...dividendsIn].sort(byDateAndId);
  const cashRows = [...cashIn].sort(byDateAndId);
  const warnings = makeWarnings();

  const days = dayRange([trades, dividends, cashRows], today);
  const n = days.length;
  if (n === 0) return emptyResult(baseCurrency);
  const indexOf = new Map(days.map((day, i) => [day, i]));

  const tickers = [...new Set(trades.map((trade) => trade.ticker))].sort();
  const tradesOf = new Map(tickers.map((ticker) => [ticker, []]));
  for (const trade of trades) tradesOf.get(trade.ticker).push(trade);

  // The currency an instrument is priced in. The instrument list is the source;
  // its own fills are the fallback, and an instrument we do not know is counted.
  const currencyOf = new Map();
  for (const ticker of tickers) {
    const instrument = instruments[ticker];
    if (!instrument) warnings.bump('UNKNOWN_INSTRUMENT', 1, ticker);
    const own = tradesOf.get(ticker);
    const currency = instrument?.currency || own[0]?.priceCurrency || baseCurrency;
    currencyOf.set(ticker, currency);
  }

  // Measured exchange rate points per currency, last fill of a day winning. A
  // corporate action moves no cash, so it can measure nothing.
  const pointsOf = new Map();
  for (const trade of trades) {
    if (trade.kind === 'CORPORATE_ACTION') {
      // No cash moves, so a tax on the row is not charged anywhere; say so rather
      // than guess (rule 4). If the total then differs, this is where to look.
      if (Array.isArray(trade.taxes) && trade.taxes.length) warnings.bump('CORPORATE_ACTION_TAX', 1, trade.ticker);
      continue;
    }
    const currency = trade.priceCurrency;
    if (!currency || currency === baseCurrency) continue;
    const rate = ratePoint(trade, baseCurrency, warnings);
    if (rate === null || !(rate > 0)) continue;
    if (!pointsOf.has(currency)) pointsOf.set(currency, new Map());
    pointsOf.get(currency).set(trade.date, rate);
  }

  // Every currency a figure may have to be converted from: the instruments', the
  // cash rows' (A20) and the dividends' payout currencies.
  const needed = new Set([baseCurrency, ...currencyOf.values()]);
  for (const row of cashRows) if (row.currency) needed.add(row.currency);
  for (const dividend of dividends) {
    if (dividend.payoutCurrency) needed.add(dividend.payoutCurrency);
  }

  /** @type {Record<string, {rate:number[], measured:boolean[]}>} */
  const fx = {};
  for (const currency of [...needed].sort()) {
    if (currency === baseCurrency) {
      fx[currency] = { rate: new Array(n).fill(1), measured: new Array(n).fill(true) };
      continue;
    }
    const points = [...(pointsOf.get(currency) ?? new Map())]
      .map(([date, rate]) => ({ date, rate }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    // Rule 4: a currency with no measured rate is not 1:1, it is unknown, and
    // everything denominated in it is left out with an error.
    if (!points.length) {
      warnings.bump('FX_NO_RATE', 1, currency);
      continue;
    }
    fx[currency] = fxSeries(points, days);
  }

  /** An amount in `currency` on day `i`, in the account currency, or null when
   * that currency has no rate at all. */
  const toBase = (amount, currency, i) => {
    if (!currency || currency === baseCurrency) return amount;
    const rates = fx[currency];
    if (!rates) return null;
    return amount / rates.rate[i];
  };

  const positionsValue = new Array(n).fill(0);
  const estimated = new Array(n).fill(false);
  /** @type {Record<string, object>} */
  const byInstrument = {};

  for (const ticker of tickers) {
    const own = tradesOf.get(ticker);
    const currency = currencyOf.get(ticker);
    const rates = fx[currency];

    // Quantities: a fill on day t counts from day t. A corporate action counts the
    // same way, BUY adding and SELL removing.
    const qty = new Array(n).fill(0);
    let running = 0;
    let negative = false;
    let next = 0;
    for (let i = 0; i < n; i += 1) {
      while (next < own.length && own[next].date <= days[i]) {
        const trade = own[next];
        running += trade.side === 'SELL' ? -trade.quantity : trade.quantity;
        if (running < -QTY_EPS) negative = true;
        next += 1;
      }
      qty[i] = running;
    }
    if (negative) warnings.bump('QUANTITY_NEGATIVE', 1, ticker);

    const closes = closesByDay(prices[ticker]);
    if (closes.size === 0) warnings.bump('PRICE_SERIES_MISSING', 1, ticker);
    // Before the first candle there is no close to carry, so the first real fill
    // price stands in and the day is estimated.
    const priced = own.find((trade) => trade.kind !== 'CORPORATE_ACTION' && trade.price > 0);
    const fallback = priced ? priced.price : (own[0]?.price ?? 0);

    const value = new Array(n).fill(0);
    const instrumentFx = new Array(n).fill(NaN);
    const instrumentEstimated = new Array(n).fill(true);
    let carried = null;
    for (let i = 0; i < n; i += 1) {
      let price;
      if (closes.has(days[i])) {
        carried = closes.get(days[i]);
        price = carried;
        instrumentEstimated[i] = false;
      } else {
        price = carried === null ? fallback : carried;
      }
      // A ledger that goes short is incomplete, not a short position: clamp.
      const held = qty[i] > QTY_EPS ? qty[i] : 0;
      if (rates) {
        instrumentFx[i] = rates.rate[i];
        value[i] = (held * price) / rates.rate[i];
      }
      positionsValue[i] += value[i];
      if (held > 0 && instrumentEstimated[i]) estimated[i] = true;
    }

    const open = qty[n - 1] > QTY_EPS;
    byInstrument[ticker] = {
      qty,
      value,
      fx: instrumentFx,
      estimated: instrumentEstimated,
      firstDate: own.length ? own[0].date : days[0],
      lastDate: open || !own.length ? null : own[own.length - 1].date,
    };
  }

  const netExternal = new Array(n).fill(0);
  const dividendGross = new Array(n).fill(0);
  const dividendWithheld = new Array(n).fill(0);
  const dividendEstimated = new Array(n).fill(false);
  const delta = new Array(n).fill(0);

  // Every cash row converted to the account currency once, so the transfer check
  // below and the cash identity work on the same numbers.
  const rows = [];
  let unknownRows = 0;
  let foreignRows = 0;
  for (const row of cashRows) {
    const i = indexOf.get(row.date);
    if (i === undefined) continue;
    if (row.category === 'UNKNOWN' || !Number.isFinite(row.amount)) {
      unknownRows += 1;
      continue;
    }
    const amount = toBase(row.amount, row.currency, i);
    if (amount === null) {
      // The currency has no rate; guessing one would be rule 4 in reverse.
      unknownRows += 1;
      continue;
    }
    if (row.currency && row.currency !== baseCurrency) foreignRows += 1;
    rows.push({ i, amount, category: row.category });
  }

  // Rule 4: TRANSFER is internal and zero-sum by definition. Transfers that do not
  // net to zero over the whole history are not transfers as far as we can tell, so
  // every one of them becomes UNKNOWN rather than half a story.
  let transferSum = 0;
  let transfers = 0;
  for (const row of rows) {
    if (row.category !== 'TRANSFER') continue;
    transferSum += row.amount;
    transfers += 1;
  }
  const transfersUnknown = transfers > 0 && Math.round(transferSum * 100) !== 0;

  for (const row of rows) {
    if (row.category === 'TRANSFER' && transfersUnknown) {
      unknownRows += 1;
      continue;
    }
    delta[row.i] += row.amount;
    // Rule 3: only a deposit or a withdrawal is external. The adapter's own
    // `external` flag is not consulted; the category defines it.
    if (row.category === 'DEPOSIT' || row.category === 'WITHDRAWAL') {
      netExternal[row.i] += row.amount;
    }
  }
  if (unknownRows) warnings.bump('CASH_UNKNOWN', unknownRows);
  if (foreignRows) warnings.bump('TX_FOREIGN_CURRENCY', foreignRows);

  let cashCarryingActions = 0;
  for (const trade of trades) {
    const i = indexOf.get(trade.date);
    if (i === undefined) continue;
    if (trade.kind === 'CORPORATE_ACTION') {
      // It changed the holding, never the cash.
      if (!corporateActionIsCashNeutral(trade)) cashCarryingActions += 1;
      continue;
    }
    const fees = Number.isFinite(trade.fees) ? trade.fees : 0;
    delta[i] += trade.settled - fees - extraTaxTotal(trade);
  }
  if (cashCarryingActions) warnings.bump('CORPORATE_ACTION_CASH', cashCarryingActions);

  let unknownDividends = 0;
  let unknownCredited = 0;
  for (const dividend of dividends) {
    const i = indexOf.get(dividend.date);
    if (i === undefined) continue;
    let credit = dividend.category !== 'UNKNOWN';
    if (!credit) {
      unknownDividends += 1;
      // An unrecognised payout is credited only when it says something usable.
      credit = Number.isFinite(dividend.net) && dividend.ticker !== null
        && dividend.ticker !== undefined;
      if (credit) unknownCredited += 1;
    }
    if (!credit) continue;
    delta[i] += dividend.net;
    // Interest paid on cash is income, not a share of profit: it belongs to the
    // cash identity and to income.js, never to the dividend arrays.
    if (!DIVIDEND_CATEGORIES.has(dividend.category) && dividend.category !== 'UNKNOWN') continue;

    // A17: the parser can only compute gross and withheld when the payout is in
    // the account currency. Otherwise it says so and the engine redoes both with
    // its own rate for that day.
    let gross = Number.isFinite(dividend.gross) ? dividend.gross : dividend.net;
    let withheld = Number.isFinite(dividend.withheld) ? dividend.withheld : 0;
    if (dividend.withheldEstimated) {
      const payout = Number.isFinite(dividend.quantity) && Number.isFinite(dividend.grossPerShare)
        ? dividend.quantity * dividend.grossPerShare
        : null;
      const converted = payout === null ? null : toBase(payout, dividend.payoutCurrency, i);
      if (converted !== null && Number.isFinite(converted)) {
        gross = converted;
        withheld = Math.max(0, gross - dividend.net);
      }
      dividendEstimated[i] = true;
    }
    dividendGross[i] += gross;
    dividendWithheld[i] += withheld;
  }
  if (unknownDividends) {
    warnings.bump('DIVIDEND_TYPE_UNKNOWN', unknownDividends, `${unknownCredited} credited`);
  }

  const cash = new Array(n);
  const value = new Array(n);
  const paidIn = new Array(n);
  const pnl = new Array(n);
  let runningCash = 0;
  let runningPaidIn = 0;
  for (let i = 0; i < n; i += 1) {
    runningCash += delta[i];
    runningPaidIn += netExternal[i];
    cash[i] = runningCash;
    paidIn[i] = runningPaidIn;
    value[i] = positionsValue[i] + cash[i];
    pnl[i] = value[i] - (i > 0 ? value[i - 1] : 0) - netExternal[i];
  }

  let estimatedDays = 0;
  for (const day of estimated) if (day) estimatedDays += 1;
  // For ESTIMATED_DAYS, detail is the number of days in the history.
  if (estimatedDays) warnings.bump('ESTIMATED_DAYS', estimatedDays, String(n));

  /** @type {Record<string, number>} */
  const positionsToday = {};
  for (const ticker of tickers) {
    const held = byInstrument[ticker].qty[n - 1];
    if (Math.abs(held) > QTY_EPS) positionsToday[ticker] = held;
  }

  return {
    days,
    value,
    positionsValue,
    cash,
    netExternal,
    paidIn,
    pnl,
    dividendGross,
    dividendWithheld,
    estimated,
    dividendEstimated,
    byInstrument,
    fx,
    positionsToday,
    warnings: warnings.list(),
    baseCurrency,
  };
}
