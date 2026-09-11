// Sync orchestration (US-15, US-16, US-17, US-11 sync side, US-12, US-13).
//
// Runs the seven steps in docs/11-DATA-FLOW.md against the injected store,
// adapter and keystore, checkpointing to meta.syncState after every completed
// page so a killed worker resumes where it left off. Stores only raw rows
// (rule 2): computation is the UI datasource's job, so this module never
// imports engine.js. Never logs; the credential is read once from keystore
// and passed straight into adapter fetch calls, never written anywhere else.

import { LetoError } from './errors.js';
import { SYNC } from './config.js';
import * as trading212Adapter from './brokers/trading212.js';

/** The seven steps, in the order they run. Also used to compare progress on resume. */
export const STEPS = Object.freeze([
  'summary',
  'instruments',
  'positions',
  'orders',
  'dividends',
  'transactions',
  'prices',
]);

const OVERLAP_DAYS = 7;
const DAY_MS = 86400000;

/** Keeps only the params safe to persist in meta.lastError (rule 7). */
const ERROR_PARAM_ALLOWLIST = Object.freeze(['endpoint', 'field']);

function stepIndex(name) {
  return STEPS.indexOf(name);
}

/** Epoch seconds (a candle's first element) to its UTC calendar day. Not imported
 * from dates.js on purpose (see trading212.js): kept local and tiny instead. */
function epochToISODate(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' plus/minus n whole days, in UTC. */
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Merges two candle arrays by epoch (first element), de-duplicated, ascending. */
function mergeCandles(existing, incoming) {
  const byEpoch = new Map();
  for (const candle of existing) byEpoch.set(candle[0], candle);
  for (const candle of incoming) byEpoch.set(candle[0], candle);
  return [...byEpoch.values()].sort((a, b) => a[0] - b[0]);
}

function filterErrorParams(params) {
  const out = {};
  for (const key of ERROR_PARAM_ALLOWLIST) {
    if (params && params[key] !== undefined) out[key] = params[key];
  }
  return out;
}

/**
 * @param {{ force?:boolean, store:object, adapter?:object, keystore:object,
 *   now?:() => number }} opts
 * @returns {Promise<{ok:boolean, skipped?:boolean, code?:string, step?:string,
 *   counts?:object}>}
 */
export async function runSync({
  force = false,
  store,
  adapter = trading212Adapter,
  keystore,
  now = () => Date.now(),
} = {}) {
  const cred = await keystore.load();
  if (!cred) return { ok: false, code: 'NO_CREDENTIAL' };

  if (!force) {
    const lastSyncAt = await store.getMeta('lastSyncAt');
    if (typeof lastSyncAt === 'number' && now() - lastSyncAt < SYNC.staleAfterMs) {
      return { ok: true, skipped: true };
    }
  }

  const priorState = await store.getMeta('syncState');
  const startedAt = priorState && typeof priorState.startedAt === 'number' ? priorState.startedAt : now();
  const startStepIndex = priorState ? stepIndex(priorState.step) : 0;
  const startPage = priorState ? priorState.page ?? null : null;

  let currentStep = STEPS[0];
  const counts = {};

  async function checkpoint(step, page) {
    currentStep = step;
    await store.setMeta('syncState', { step, page: page ?? null, startedAt });
  }

  /** Runs one non-paginated step unless a later step already completed it. */
  async function maybeRun(name, fn) {
    const idx = stepIndex(name);
    if (idx < startStepIndex) return;
    await checkpoint(name, null);
    await fn();
    await checkpoint(name, null);
  }

  /** Reads/writes meta.cursors.<name>.lastSeenDate, keeping the max seen. */
  async function bumpLastSeenDate(name, maxDate) {
    if (!maxDate) return;
    const cursors = (await store.getMeta('cursors')) || {};
    const cur = cursors[name] && cursors[name].lastSeenDate;
    const next = !cur || maxDate > cur ? maxDate : cur;
    await store.setMeta('cursors', { ...cursors, [name]: { lastSeenDate: next } });
  }

  /**
   * Runs one paginated step (orders/dividends/transactions): walks pages from
   * the first page (or the saved cursor when resuming into this exact step)
   * until nextPagePath is null, or, once a lastSeenDate exists for this step,
   * until a page's rows are all older than lastSeenDate minus the overlap
   * window. Every row is stored via upsert, so re-walked overlap is harmless.
   * @returns {Promise<number>} total skipped-without-fill rows this run.
   */
  async function runPaginatedStep(name, fetchPage, parse) {
    const idx = stepIndex(name);
    if (idx < startStepIndex) return 0;

    const resuming = idx === startStepIndex;
    let cursor = resuming ? startPage : undefined;
    await checkpoint(name, cursor ?? null);

    const cursors = (await store.getMeta('cursors')) || {};
    const lastSeenDate = cursors[name] && cursors[name].lastSeenDate;
    const cutoff = lastSeenDate ? addDaysISO(lastSeenDate, -OVERLAP_DAYS) : null;

    let skipped = 0;
    let maxDate = lastSeenDate || null;

    for (;;) {
      const raw = await fetchPage(cursor);
      const rows = await parse(raw);
      skipped += rows.skipped ?? 0;

      if (rows.length) {
        await store.put(name, rows);
        for (const row of rows) {
          if (!maxDate || row.date > maxDate) maxDate = row.date;
        }
      }

      const nextPagePath = (raw && raw.nextPagePath) ?? null;
      cursor = nextPagePath;
      await checkpoint(name, cursor);
      await bumpLastSeenDate(name, maxDate);

      if (!nextPagePath) break;
      if (cutoff && rows.length > 0 && rows.every((row) => row.date < cutoff)) break;
    }

    await checkpoint(name, null);
    return skipped;
  }

  /** Runs the prices step: one price series per ticker that appears in any
   * stored order, fetched backwards to the ticker's first trade (fresh) or
   * forwards from the last stored candle (incremental). */
  async function runPricesStep() {
    const idx = stepIndex('prices');
    if (idx < startStepIndex) return;

    const orders = await store.all('orders');
    const firstTradeDate = new Map();
    for (const order of orders) {
      if (!order.ticker) continue;
      const cur = firstTradeDate.get(order.ticker);
      if (!cur || order.date < cur) firstTradeDate.set(order.ticker, order.date);
    }
    const tickers = [...firstTradeDate.keys()].sort();

    const resuming = idx === startStepIndex && startPage && startPage.ticker;
    let startIdx = 0;
    let resumeTo;
    if (resuming) {
      const found = tickers.indexOf(startPage.ticker);
      startIdx = found >= 0 ? found : 0;
      resumeTo = startPage.to;
    }

    await checkpoint('prices', resuming ? startPage : null);

    for (let i = startIdx; i < tickers.length; i += 1) {
      const ticker = tickers[i];
      const existing = await store.get('prices', ticker);
      const instrument = await store.get('instruments', ticker);
      const currency = instrument ? instrument.currency ?? null : null;
      let candles = existing ? existing.candles.slice() : [];
      const storedLast = existing && existing.candles.length
        ? existing.candles[existing.candles.length - 1][0]
        : null;

      let to = i === startIdx && resuming ? resumeTo : undefined;

      for (;;) {
        const raw = await adapter.fetchPrices({ ticker, to });
        const parsed = adapter.parsePrices(raw, ticker);

        if (parsed.candles.length === 0) break;
        candles = mergeCandles(candles, parsed.candles);
        await store.put('prices', [{ ticker, currency, candles }]);

        const earliest = parsed.candles[0][0];
        if (existing) {
          if (storedLast !== null && earliest <= storedLast) break;
        } else if (epochToISODate(earliest) <= firstTradeDate.get(ticker)) {
          break;
        }
        to = earliest - 1;
        await checkpoint('prices', { ticker, to });
      }
      await checkpoint('prices', null);
    }
  }

  try {
    await maybeRun('summary', async () => {
      const raw = await adapter.fetchSummary({ cred });
      const summary = adapter.parseSummary(raw);
      await store.put('summary', [{ key: 'current', ...summary }]);
      await store.setMeta('currency', summary.currency);
    });

    await maybeRun('instruments', async () => {
      const fetchedAt = await store.getMeta('instrumentsFetchedAt');
      if (!fetchedAt || now() - fetchedAt >= SYNC.instrumentsMaxAgeMs) {
        const raw = await adapter.fetchInstruments({ cred });
        const parsed = adapter.parseInstruments(raw);
        await store.put('instruments', Object.values(parsed));
        await store.setMeta('instrumentsFetchedAt', now());
      }
    });

    await maybeRun('positions', async () => {
      const raw = await adapter.fetchPositions({ cred });
      const parsed = adapter.parsePositions(raw);
      await store.clear('positions');
      await store.put('positions', parsed);
    });

    const ordersSkipped = await runPaginatedStep(
      'orders',
      (cursor) => adapter.fetchOrders({ cred, cursor }),
      (raw) => adapter.parseOrders(raw),
    );
    if (ordersSkipped) counts.ordersUnfilledSkipped = ordersSkipped;

    await runPaginatedStep(
      'dividends',
      (cursor) => adapter.fetchDividends({ cred, cursor }),
      async (raw) => {
        const accountCurrency = await store.getMeta('currency');
        return adapter.parseDividends(raw, accountCurrency);
      },
    );

    await runPaginatedStep(
      'transactions',
      (cursor) => adapter.fetchTransactions({ cred, cursor }),
      (raw) => adapter.parseTransactions(raw),
    );

    await runPricesStep();

    await store.setMeta('lastSyncAt', now());
    await store.deleteMeta('syncState');
    await store.setMeta('lastError', null);
    return { ok: true, counts };
  } catch (err) {
    if (err instanceof LetoError) {
      await store.setMeta('lastError', {
        code: err.code,
        step: currentStep,
        params: filterErrorParams(err.params),
      });
      return { ok: false, code: err.code, step: currentStep };
    }
    throw err;
  }
}
