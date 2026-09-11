// Builds the one model every page reads (US-20/30/40/50/80, data side). Demo mode
// reads the US-02 fixtures through an injected `fetchJson`; live mode reads the
// stores. Nothing here is rounded and nothing here is a clock: `today`, when not
// given, is derived from the data itself (the last day available), never from
// `Date.now()` except as the documented last-resort fallback for a live account
// with no data at all yet.

import { computePortfolio } from '../lib/engine.js';
import { buildComposition } from '../lib/composition.js';
import { summarise } from '../lib/income.js';
import { reconcile } from '../lib/reconcile.js';
import { NOTICES, render } from '../lib/notices.js';
import { COMPOSITION_TOP } from '../lib/config.js';
import { toISODate } from '../lib/dates.js';

const RECONCILE_CODE_BY_STATUS = Object.freeze({
  OK: 'RECONCILE_OK',
  QUANTITY_MISMATCH: 'RECONCILE_QUANTITY',
  VALUE_MISMATCH: 'RECONCILE_VALUE',
  UNVERIFIED: 'RECONCILE_UNVERIFIED',
});

const LEVEL_ORDER = Object.freeze({ error: 0, warn: 1, note: 2, ok: 3 });

function keyByTicker(rows) {
  const out = {};
  for (const row of rows ?? []) if (row?.ticker) out[row.ticker] = row;
  return out;
}

/** A warning's `detail` means a different thing per code (a ticker, a currency, a
 * day count, ...); offering it under every placeholder name a notice sentence
 * might use is simpler than a per-code table and just as safe: `render` leaves
 * any placeholder standing that a param does not fill. */
function renderWarning(warning) {
  const notice = NOTICES[warning.code];
  if (!notice) return { code: warning.code, level: 'warn', text: warning.code, count: warning.count ?? 1 };
  const params = {
    count: warning.count,
    total: warning.detail,
    ticker: warning.detail,
    currency: warning.detail,
    endpoint: warning.detail,
    field: warning.detail,
    step: warning.detail,
    ratio: warning.detail,
    date: warning.detail,
  };
  return { code: warning.code, level: notice.level, text: render(warning.code, params), count: warning.count ?? 1 };
}

function reconciliationNotice(reconciliation) {
  const code = RECONCILE_CODE_BY_STATUS[reconciliation?.status] ?? 'RECONCILE_UNVERIFIED';
  const notice = NOTICES[code];
  const params = {
    count: reconciliation?.quantityDeltas?.length ?? 0,
    delta: reconciliation?.deltaValue,
  };
  return { code, level: notice.level, text: render(code, params), count: params.count };
}

/** @param {{ result:object, reconciliation:object, meta:object, demo:boolean }} args */
function buildNotices({ result, reconciliation, meta, demo }) {
  const list = [];

  for (const warning of result?.warnings ?? []) list.push(renderWarning(warning));

  list.push(reconciliationNotice(reconciliation));

  const hasCashUnknown = (result?.warnings ?? []).some((w) => w.code === 'CASH_UNKNOWN');
  if (!hasCashUnknown) {
    list.push({
      code: 'CASH_ALL_KNOWN',
      level: NOTICES.CASH_ALL_KNOWN.level,
      text: render('CASH_ALL_KNOWN'),
      count: 1,
    });
  }

  const lastErrorCode = meta?.lastError?.code;
  if (lastErrorCode && NOTICES[lastErrorCode]) {
    list.push({
      code: lastErrorCode,
      level: NOTICES[lastErrorCode].level,
      text: render(lastErrorCode, meta.lastError),
      count: 1,
    });
  }

  if (demo) {
    list.push({ code: 'DEMO_DATA', level: NOTICES.DEMO_DATA.level, text: render('DEMO_DATA'), count: 1 });
  }

  return list.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** The last day with data: the latest candle across every price series, or the
 * latest trade date, whichever is later; the current UTC date only when neither
 * exists (a fresh live account, nothing synced yet). */
function computeToday(todayParam, trades, prices) {
  if (todayParam) return todayParam;
  let latest = null;
  for (const series of Object.values(prices ?? {})) {
    const candles = series?.candles ?? [];
    if (!candles.length) continue;
    const date = toISODate(candles[candles.length - 1][0]);
    if (!latest || date > latest) latest = date;
  }
  for (const trade of trades ?? []) {
    if (trade?.date && (!latest || trade.date > latest)) latest = trade.date;
  }
  return latest || new Date().toISOString().slice(0, 10);
}

async function loadDemoRaw(fetchJson) {
  const account = await fetchJson('../../fixtures/account.json');
  const truth = await fetchJson('../../fixtures/truth.json');
  return {
    trades: account.trades ?? [],
    dividends: account.dividends ?? [],
    cashRows: account.cashRows ?? [],
    instruments: keyByTicker(account.instruments),
    prices: account.prices ?? {},
    positions: truth.positionsToday ?? [],
    summary: truth.summaryToday ?? null,
    currency: truth.summaryToday?.currency || 'EUR',
    today: account?.meta?.today || truth?.meta?.today || null,
    meta: {},
  };
}

async function loadLiveRaw(store) {
  const [orders, dividends, transactions, instrumentRows, priceRows, positions, summaryRows, metaRows] =
    await Promise.all([
      store.all('orders'),
      store.all('dividends'),
      store.all('transactions'),
      store.all('instruments'),
      store.all('prices'),
      store.all('positions'),
      store.all('summary'),
      store.all('meta'),
    ]);
  const meta = {};
  for (const row of metaRows ?? []) meta[row.key] = row.value;
  const summary = (summaryRows ?? [])[0] ?? null;
  return {
    trades: orders ?? [],
    dividends: dividends ?? [],
    cashRows: transactions ?? [],
    instruments: keyByTicker(instrumentRows),
    prices: keyByTicker(priceRows),
    positions: positions ?? [],
    summary,
    currency: summary?.currency || meta.currency || 'EUR',
    today: null,
    meta,
  };
}

/**
 * @param {{ demo?:boolean, store?:object|null, fetchJson?:((url:string)=>Promise<object>)|null,
 *   today?:string|null }} [opts]
 * @returns {Promise<object>} the model every page renders from
 */
export async function loadModel({ demo = false, store = null, fetchJson = null, today = null } = {}) {
  const raw = demo ? await loadDemoRaw(fetchJson) : await loadLiveRaw(store);
  const resolvedToday = demo
    ? (today || raw.today || computeToday(null, raw.trades, raw.prices))
    : computeToday(today, raw.trades, raw.prices);
  const currency = raw.currency || 'EUR';

  const result = computePortfolio({
    trades: raw.trades,
    dividends: raw.dividends,
    cashRows: raw.cashRows,
    instruments: raw.instruments,
    prices: raw.prices,
    today: resolvedToday,
    baseCurrency: currency,
  });

  const composition = buildComposition(result, { top: COMPOSITION_TOP });
  const income = summarise({ dividends: raw.dividends, trades: raw.trades, cashRows: raw.cashRows });
  const reconciliation = reconcile(result, raw.positions, raw.summary);
  const notices = buildNotices({ result, reconciliation, meta: raw.meta, demo });

  return {
    demo,
    today: resolvedToday,
    currency,
    instruments: raw.instruments,
    trades: raw.trades,
    dividends: raw.dividends,
    cashRows: raw.cashRows,
    prices: raw.prices,
    positions: raw.positions,
    summary: raw.summary,
    result,
    composition,
    income,
    reconciliation,
    notices,
    meta: raw.meta,
  };
}
