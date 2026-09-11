// The Trading 212 adapter (ADR-007). Implements the broker boundary contract in
// `./index.js` against the endpoint table in `../config.js` and the schemas in
// `docs/API-SPEC-NOTES.md`. Every request this module can build is a read: the
// hosts in `hosts`, the paths in `../config.js` ENDPOINTS and OHLC. Nothing here
// places, changes or cancels an order (rule 1); a test greps this file for the
// verbs that would.
//
// `cred` is produced by `keystore.js` and consumed by `net.js`; this module reads
// only `cred.env` ('live'|'demo') to choose a host and forwards `cred` itself to
// `throttledFetch` untouched, as the credential net.js signs the request with.
//
// This module does not import `../net.js` at the top level, because that module
// may not exist yet while this one is being built; `_setFetcher` lets tests inject
// a fake and production code falls back to a dynamic import on first use.

import { LetoError } from '../errors.js';
import { HOSTS, API_PREFIX, ENDPOINTS, PAGE_LIMIT, OHLC } from '../config.js';
import { throttledFetch } from '../net.js';

export const id = 'trading212';
export const label = 'Trading 212';
export const hosts = Object.freeze({ live: HOSTS.live, demo: HOSTS.demo, charting: HOSTS.charting });

// ---------------------------------------------------------------------------
// Fetcher: net.js, statically imported. A dynamic import() is not allowed in a
// service worker and made every real connect fail (found end to end, 2026-09-08).
// ---------------------------------------------------------------------------

let _fetcher = null;

/** Test-only seam: inject a fake `throttledFetch(url, opts)`. */
export function _setFetcher(fn) {
  _fetcher = fn;
}

async function getFetcher() {
  return _fetcher ?? throttledFetch;
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

function withQuery(base, params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return base;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${base}?${qs}`;
}

/** Builds a URL on the account host (live or demo) for one endpoint key. */
function url(cred, endpointKey, params = {}) {
  const ep = ENDPOINTS[endpointKey];
  const host = HOSTS[cred?.env] ?? HOSTS.live;
  return withQuery(`${host}${API_PREFIX}${ep.path}`, params);
}

/** Builds the OHLC URL on the charting host. `to` is unix seconds, optional. */
function ohlcUrl({ ticker, to }) {
  const params = { ticker, size: OHLC.size };
  if (to !== undefined && to !== null) params.to = to;
  return withQuery(`${HOSTS.charting}${OHLC.path}`, params);
}

/** Every URL this adapter can ever produce: one per config.js endpoint, first
 * page only, plus the OHLC URL with a placeholder ticker. Used by the URL
 * allowlist test (rule 1) and nowhere else. */
export function ALL_URLS(cred) {
  const c = cred ?? { env: 'live' };
  const urls = Object.keys(ENDPOINTS).map((key) => {
    const params = ENDPOINTS[key].paginated ? { limit: PAGE_LIMIT } : {};
    return url(c, key, params);
  });
  urls.push(ohlcUrl({ ticker: 'ALFA_NL_EQ' }));
  return urls;
}

// ---------------------------------------------------------------------------
// Fetch members
// ---------------------------------------------------------------------------

async function getJson(u, opts) {
  const fetcher = await getFetcher();
  const res = await fetcher(u, opts);
  // net.throttledFetch resolves to {status, json, headers} with `json` already parsed.
  // A Response-like object with a json() method is accepted as well, for the fakes.
  return typeof res.json === 'function' ? res.json() : res.json;
}

async function fetchSimple(endpointKey, cred) {
  const ep = ENDPOINTS[endpointKey];
  return getJson(url(cred, endpointKey), { auth: cred, minMs: ep.minMs });
}

/** Paginated endpoints answer `{items, nextPagePath}`. When `cursor` is a path
 * string starting with the API prefix, it is the verbatim `nextPagePath` from a
 * previous page and is requested as-is; otherwise it is sent as a `cursor` query
 * parameter on the endpoint's own path. */
async function fetchPage(endpointKey, cred, cursor) {
  const ep = ENDPOINTS[endpointKey];
  let u;
  if (typeof cursor === 'string' && cursor.startsWith(API_PREFIX)) {
    // nextPagePath comes from the API and is trusted only as far as the allowlist:
    // same host, same documented path, GET. Anything else is a shape change.
    u = `${HOSTS[cred?.env] ?? HOSTS.live}${cursor}`;
    if (new URL(u).pathname !== `${API_PREFIX}${ep.path}`) {
      throw new LetoError('SHAPE_CHANGED', { endpoint: endpointKey, field: 'nextPagePath' });
    }
  } else {
    u = url(cred, endpointKey, { cursor, limit: PAGE_LIMIT });
  }
  return getJson(u, { auth: cred, minMs: ep.minMs });
}

export async function fetchInstruments({ cred }) {
  return fetchSimple('instruments', cred);
}

export async function fetchPositions({ cred }) {
  return fetchSimple('positions', cred);
}

/** There is no separate cash endpoint (API-SPEC-NOTES §3): cash lives inside the
 * summary response, so this hits the same endpoint as fetchSummary. */
export async function fetchCash({ cred }) {
  return fetchSimple('summary', cred);
}

export async function fetchSummary({ cred }) {
  return fetchSimple('summary', cred);
}

export async function fetchOrders({ cred, cursor }) {
  return fetchPage('orders', cred, cursor);
}

export async function fetchDividends({ cred, cursor }) {
  return fetchPage('dividends', cred, cursor);
}

export async function fetchTransactions({ cred, cursor }) {
  return fetchPage('transactions', cred, cursor);
}

/** Public, unauthenticated, on the charting host. */
export async function fetchPrices({ ticker, to }) {
  return getJson(ohlcUrl({ ticker, to }), { auth: null, minMs: OHLC.minMs });
}

export async function checkCredential({ cred }) {
  try {
    const raw = await fetchSummary({ cred });
    const currency = need(raw, 'currency', 'summary');
    return { ok: true, account: { currency } };
  } catch (err) {
    if (err instanceof LetoError) return { ok: false, code: err.code };
    return { ok: false, code: 'UPSTREAM_ERROR' };
  }
}

// ---------------------------------------------------------------------------
// Required-field validation
// ---------------------------------------------------------------------------

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Throws SHAPE_CHANGED when the field at `path` is missing, or (with
 * `opts.type === 'number'`) present but not a number. Returns the value. */
export function need(obj, path, endpoint, opts = {}) {
  const value = getPath(obj, path);
  if (value === undefined || value === null) {
    throw new LetoError('SHAPE_CHANGED', { endpoint, field: path });
  }
  if (opts.type === 'number' && typeof value !== 'number') {
    throw new LetoError('SHAPE_CHANGED', { endpoint, field: path });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local date helper (filedAt/paidOn/dateTime -> 'YYYY-MM-DD' UTC). Not imported
// from dates.js on purpose: that module is owned by another agent right now.
// ---------------------------------------------------------------------------

function dateOnly(isoDateTime) {
  const d = new Date(isoDateTime);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function itemsOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
}

/** A number the API may have sent as a string; null when it is not a number at all.
 * Without this, `sum + amount` on a string concatenates instead of adding and `fees`
 * becomes text without anything throwing. */
function toNum(value) {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parseSummary(raw) {
  const currency = need(raw, 'currency', 'summary');
  const freeCash = need(raw, 'cash.availableToTrade', 'summary', { type: 'number' });
  const pieCash = need(raw, 'cash.inPies', 'summary', { type: 'number' });
  const reservedCash = need(raw, 'cash.reservedForOrders', 'summary', { type: 'number' });
  const investmentsValue = need(raw, 'investments.currentValue', 'summary', { type: 'number' });
  return {
    currency,
    investmentsValue,
    freeCash,
    pieCash,
    reservedCash,
    total: investmentsValue + freeCash + pieCash + reservedCash,
  };
}

/** Kept for the contract; cash lives in the same response as the summary. */
export function parseCash(raw) {
  return parseSummary(raw);
}

export function parsePositions(raw) {
  return itemsOf(raw).map((p) => {
    const ticker = need(p, 'instrument.ticker', 'positions');
    const quantity = need(p, 'quantity', 'positions', { type: 'number' });
    return {
      ticker,
      quantity,
      averagePrice: p.averagePricePaid ?? null,
      currentPrice: p.currentPrice ?? null,
      currentValue: p.walletImpact?.currentValue ?? null,
    };
  });
}

export function parseInstruments(raw) {
  const out = {};
  for (const it of itemsOf(raw)) {
    const ticker = need(it, 'ticker', 'instruments');
    out[ticker] = {
      ticker,
      isin: it.isin ?? null,
      name: it.name ?? null,
      shortName: it.shortName ?? null,
      currency: it.currencyCode ?? null,
      type: it.type ?? null,
      exchangeId: it.workingScheduleId ?? null,
      quantityPrecision: 8,
      digitsPrecision: 2,
    };
  }
  return out;
}

const TRADE_FEE_NAMES = Object.freeze([
  'COMMISSION_TURNOVER',
  'TRANSACTION_FEE',
  'CURRENCY_CONVERSION_FEE',
  'FINRA_FEE',
  'PTM_LEVY',
]);
const TRADE_FEE_NAME_SET = new Set(TRADE_FEE_NAMES);

/** parseOrders' full detail: the trades plus how many items had no fill. */
export function parseOrdersDetailed(raw) {
  const trades = [];
  let skipped = 0;
  for (const item of itemsOf(raw)) {
    const fill = item?.fill;
    if (!fill) {
      skipped += 1;
      continue;
    }
    const order = item.order ?? {};
    need(order, 'id', 'orders');
    const side = need(order, 'side', 'orders');
    const currency = order?.instrument?.currency ?? order?.currency;
    if (currency == null) {
      throw new LetoError('SHAPE_CHANGED', { endpoint: 'orders', field: 'order.instrument.currency' });
    }
    need(fill, 'id', 'orders');
    const filledAt = need(fill, 'filledAt', 'orders');
    const price = need(fill, 'price', 'orders', { type: 'number' });
    const rawQuantity = need(fill, 'quantity', 'orders', { type: 'number' });
    const fillType = need(fill, 'type', 'orders');
    const netValue = need(fill, 'walletImpact.netValue', 'orders', { type: 'number' });

    const kind = fillType === 'TRADE' ? 'TRADE' : 'CORPORATE_ACTION';

    const taxes = (fill.walletImpact?.taxes ?? []).map((t) => {
      const amount = toNum(t.quantity);
      if (amount === null) throw new LetoError('SHAPE_CHANGED', { endpoint: 'orders', field: 'fill.walletImpact.taxes.quantity' });
      return { name: t.name, amount };
    });
    const fees = kind === 'TRADE'
      ? taxes.filter((t) => TRADE_FEE_NAME_SET.has(t.name)).reduce((sum, t) => sum + t.amount, 0)
      : 0;

    let settled = 0;
    if (kind === 'TRADE') {
      if (netValue !== 0) {
        const contradicts = (side === 'BUY' && netValue > 0) || (side === 'SELL' && netValue < 0);
        if (contradicts) {
          throw new LetoError('SHAPE_CHANGED', { endpoint: 'orders', field: 'fill.walletImpact.netValue.sign' });
        }
      }
      settled = netValue;
    }

    const fxRate = toNum(fill.walletImpact?.fxRate) || null;

    trades.push({
      id: String(fill.id),
      date: dateOnly(filledAt),
      dateTime: filledAt,
      ticker: order.ticker ?? order.instrument?.ticker ?? null,
      side,
      quantity: Math.abs(rawQuantity),
      price,
      priceCurrency: currency,
      settled,
      fxRate,
      fees,
      taxes,
      kind,
      rawType: fillType,
      source: 'api',
    });
  }
  return { trades, skipped };
}

export function parseOrders(raw) {
  const { trades, skipped } = parseOrdersDetailed(raw);
  Object.defineProperty(trades, 'skipped', { value: skipped, enumerable: false });
  return trades;
}

/** The 58 documented `HistoryDividendItem.type` values (API-SPEC-NOTES §4). */
export const DIVIDEND_TYPES = Object.freeze([
  'ORDINARY', 'BONUS', 'PROPERTY_INCOME', 'RETURN_OF_CAPITAL_NON_US', 'DEMERGER',
  'INTEREST', 'CAPITAL_GAINS_DISTRIBUTION_NON_US', 'INTERIM_LIQUIDATION',
  'ORDINARY_MANUFACTURED_PAYMENT', 'BONUS_MANUFACTURED_PAYMENT',
  'PROPERTY_INCOME_MANUFACTURED_PAYMENT', 'RETURN_OF_CAPITAL_NON_US_MANUFACTURED_PAYMENT',
  'DEMERGER_MANUFACTURED_PAYMENT', 'INTEREST_MANUFACTURED_PAYMENT',
  'CAPITAL_GAINS_DISTRIBUTION_NON_US_MANUFACTURED_PAYMENT',
  'INTERIM_LIQUIDATION_MANUFACTURED_PAYMENT', 'INTEREST_PAID_BY_US_OBLIGORS',
  'INTEREST_PAID_BY_FOREIGN_CORPORATIONS', 'DIVIDENDS_PAID_BY_US_CORPORATIONS',
  'DIVIDENDS_PAID_BY_FOREIGN_CORPORATIONS', 'CAPITAL_GAINS',
  'REAL_PROPERTY_INCOME_AND_NATURAL_RESOURCES_ROYALTIES', 'OTHER_INCOME',
  'QUALIFIED_INVESTMENT_ENTITY', 'TRUST_DISTRIBUTION',
  'PUBLICLY_TRADED_PARTNERSHIP_DISTRIBUTION', 'CAPITAL_GAINS_DISTRIBUTION',
  'RETURN_OF_CAPITAL', 'OTHER_DIVIDEND_EQUIVALENT',
  'TAX_EVENT_1446F_FOR_PUBLICLY_TRADED_SECURITIES', 'PTP_UNCHARACTERISED_INCOME',
  'MULTIPLE_1042S_TAX_COMPONENTS', 'DIVIDEND', 'SHORT_TERM_CAPITAL_GAINS',
  'LONG_TERM_CAPITAL_GAINS', 'PROPERTY_INCOME_DISTRIBUTION', 'TAX_EXEMPTED',
  'INTEREST_PAID_BY_US_OBLIGORS_MANUFACTURED_PAYMENT',
  'INTEREST_PAID_BY_FOREIGN_CORPORATIONS_MANUFACTURED_PAYMENT',
  'DIVIDENDS_PAID_BY_US_CORPORATIONS_MANUFACTURED_PAYMENT',
  'DIVIDENDS_PAID_BY_FOREIGN_CORPORATIONS_MANUFACTURED_PAYMENT',
  'CAPITAL_GAINS_MANUFACTURED_PAYMENT',
  'REAL_PROPERTY_INCOME_AND_NATURAL_RESOURCES_ROYALTIES_MANUFACTURED_PAYMENT',
  'OTHER_INCOME_MANUFACTURED_PAYMENT', 'QUALIFIED_INVESTMENT_ENTITY_MANUFACTURED_PAYMENT',
  'TRUST_DISTRIBUTION_MANUFACTURED_PAYMENT',
  'PUBLICLY_TRADED_PARTNERSHIP_DISTRIBUTION_MANUFACTURED_PAYMENT',
  'CAPITAL_GAINS_DISTRIBUTION_MANUFACTURED_PAYMENT', 'RETURN_OF_CAPITAL_MANUFACTURED_PAYMENT',
  'OTHER_DIVIDEND_EQUIVALENT_MANUFACTURED_PAYMENT',
  'TAX_EVENT_1446F_FOR_PUBLICLY_TRADED_SECURITIES_MANUFACTURED_PAYMENT',
  'PTP_UNCHARACTERISED_INCOME_MANUFACTURED_PAYMENT',
  'MULTIPLE_1042S_TAX_COMPONENTS_MANUFACTURED_PAYMENT', 'DIVIDEND_MANUFACTURED_PAYMENT',
  'SHORT_TERM_CAPITAL_GAINS_MANUFACTURED_PAYMENT', 'LONG_TERM_CAPITAL_GAINS_MANUFACTURED_PAYMENT',
  'PROPERTY_INCOME_DISTRIBUTION_MANUFACTURED_PAYMENT', 'TAX_EXEMPTED_MANUFACTURED_PAYMENT',
]);
const DIVIDEND_TYPE_SET = new Set(DIVIDEND_TYPES);

function dividendCategory(type) {
  if (type.endsWith('_MANUFACTURED_PAYMENT')) return 'MANUFACTURED';
  if (type.startsWith('RETURN_OF_CAPITAL')) return 'RETURN_OF_CAPITAL';
  if (type.startsWith('INTEREST')) return 'INTEREST';
  if (DIVIDEND_TYPE_SET.has(type)) return 'DIVIDEND';
  return 'UNKNOWN';
}

/** `accountCurrency` is the second argument per the parsing rules: it decides
 * whether gross/withheld are computed exactly or estimated. */
export function parseDividends(raw, accountCurrency) {
  return itemsOf(raw).map((d) => {
    const reference = need(d, 'reference', 'dividends');
    const paidOn = need(d, 'paidOn', 'dividends');
    const amount = need(d, 'amount', 'dividends', { type: 'number' });
    const ticker = d.ticker ?? d.instrument?.ticker ?? null;
    if (ticker == null) {
      throw new LetoError('SHAPE_CHANGED', { endpoint: 'dividends', field: 'ticker' });
    }
    const type = need(d, 'type', 'dividends');
    const tickerCurrency = d.tickerCurrency ?? d.instrument?.currency ?? null;
    const quantity = toNum(d.quantity);
    const grossPerShare = toNum(d.grossAmountPerShare);

    let gross;
    let withheld;
    let withheldEstimated;
    if (tickerCurrency != null && tickerCurrency === accountCurrency) {
      gross = quantity != null && grossPerShare != null ? quantity * grossPerShare : amount;
      withheld = Math.max(0, gross - amount);
      withheldEstimated = false;
    } else {
      gross = amount;
      withheld = 0;
      withheldEstimated = true;
    }

    return {
      id: reference,
      date: dateOnly(paidOn),
      ticker,
      quantity,
      gross,
      withheld,
      net: amount,
      withheldEstimated,
      grossPerShare,
      payoutCurrency: tickerCurrency,
      rawType: type,
      category: dividendCategory(type),
    };
  });
}

function transactionCategory(type) {
  switch (type) {
    case 'DEPOSIT': return { category: 'DEPOSIT', external: true };
    case 'WITHDRAW': return { category: 'WITHDRAWAL', external: true };
    case 'FEE': return { category: 'FEE', external: false };
    case 'INTEREST_ON_FREE_CASH': return { category: 'INTEREST', external: false };
    case 'LENDING_INTEREST': return { category: 'LENDING', external: false };
    case 'TRANSFER': return { category: 'TRANSFER', external: false };
    default: return { category: 'UNKNOWN', external: false };
  }
}

export function parseTransactions(raw) {
  return itemsOf(raw).map((t) => {
    const reference = need(t, 'reference', 'transactions');
    const dateTime = need(t, 'dateTime', 'transactions');
    const rawAmount = need(t, 'amount', 'transactions', { type: 'number' });
    const currency = need(t, 'currency', 'transactions');
    const type = need(t, 'type', 'transactions');
    const { category, external } = transactionCategory(type);

    let amount = rawAmount;
    if (type === 'DEPOSIT') amount = Math.abs(rawAmount);
    if (type === 'WITHDRAW') amount = -Math.abs(rawAmount);

    return {
      id: reference,
      date: dateOnly(dateTime),
      amount,
      currency,
      rawType: type,
      category,
      external,
    };
  });
}

export function parsePrices(raw, ticker) {
  const candles = Array.isArray(raw) ? raw : raw?.candles;
  if (!Array.isArray(candles)) {
    throw new LetoError('SHAPE_CHANGED', { endpoint: 'prices', field: 'candles' });
  }
  let lastTime = -Infinity;
  for (const candle of candles) {
    if (!Array.isArray(candle) || candle.length !== 6 || candle.some((v) => typeof v !== 'number')) {
      throw new LetoError('SHAPE_CHANGED', { endpoint: 'prices', field: 'candle' });
    }
    if (candle[0] <= lastTime) {
      throw new LetoError('SHAPE_CHANGED', { endpoint: 'prices', field: 'candle.time' });
    }
    lastTime = candle[0];
  }
  return { ticker, currency: null, candles };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

export function explain(code, error) {
  switch (code) {
    case 'KEY_INVALID':
      return 'The API key was refused. Make a new key in the Trading 212 app and paste it again.';
    case 'KEY_SCOPE_MISSING': {
      const scope = error?.params?.scope;
      return scope
        ? `The key lacks the "${scope}" read permission. Edit the key in the app and tick every read permission.`
        : 'The key lacks a read permission. Edit the key in the app and tick every read permission.';
    }
    case 'RATE_LIMITED':
      return 'Trading 212 asked us to slow down; the sync will continue later.';
    case 'SHAPE_CHANGED': {
      const endpoint = error?.params?.endpoint ?? 'the API';
      const field = error?.params?.field ?? 'a field';
      return `A response from ${endpoint} no longer has the field ${field}. Figures that depend on it are hidden.`;
    }
    case 'UPSTREAM_ERROR':
      return 'Trading 212 returned an unexpected error. Try again later.';
    default:
      return 'Something unexpected happened talking to Trading 212.';
  }
}
