// Every number and date string the app shows, in one place, so the tone and the
// separators never drift between pages. One locale for the whole app: nl-NL number
// formatting (thousands '.', decimals ','), with a currency symbol before the number
// and a true minus sign (U+2212) for negatives, never a hyphen.
//
// Pure. No DOM, no clock, no browser API. `opts.masked` returns the fixed-width mask
// from anon.js for money and quantities (US-70 AC1); percentages and dates are never
// masked, because a masked percentage or date would say nothing useful and would
// still leak the shape of the account.

import { MASK, maskAmount, maskQty } from './anon.js';
import { SYNC_STEPS } from '../lib/config.js';

const MINUS = '−';
const THIN_SPACE = ' ';

const SYMBOLS = Object.freeze({ EUR: '€', USD: '$', GBP: '£' });

const MONTHS = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

/** nl-NL grouping and decimal separators, cached: every formatter below reuses it
 * rather than constructing an Intl.NumberFormat per call. */
const NL_INT = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const NL_MONEY = new Intl.NumberFormat('nl-NL', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * @param {number} n
 * @param {string} [currency]
 * @param {{ masked?:boolean, sign?:boolean }} [opts]
 * @returns {string}
 */
export function fmtMoney(n, currency = 'EUR', opts = {}) {
  if (opts.masked) return maskAmount(String(n));
  if (!Number.isFinite(n)) return 'n/a';
  const symbol = SYMBOLS[currency] || currency;
  const negative = n < 0;
  const magnitude = NL_MONEY.format(Math.abs(n));
  const sign = negative ? MINUS : (opts.sign && n > 0 ? '+' : '');
  return `${sign}${symbol}${THIN_SPACE}${magnitude}`;
}

/**
 * @param {number|null} x a fraction, 0.431 for 43.1%
 * @param {{ digits?:number, sign?:boolean }} [opts]
 * @returns {string}
 */
export function fmtPct(x, opts = {}) {
  const { digits = 1, sign = false } = opts;
  if (x === null || x === undefined || !Number.isFinite(x)) return 'n/a';
  const pct = x * 100;
  const negative = pct < 0;
  const magnitude = Math.abs(pct).toFixed(digits).replace('.', ',');
  const prefix = negative ? MINUS : (sign && pct > 0 ? '+' : '');
  return `${prefix}${magnitude}%`;
}

/**
 * @param {number} n
 * @param {number} [precision]
 * @param {{ masked?:boolean }} [opts]
 * @returns {string}
 */
export function fmtQty(n, precision = 8, opts = {}) {
  if (opts.masked) return maskQty(String(n));
  if (!Number.isFinite(n)) return 'n/a';
  const negative = n < 0;
  const fixed = Math.abs(n).toFixed(Math.max(0, precision));
  const [intPart, decPartRaw = ''] = fixed.split('.');
  const decPart = decPartRaw.replace(/0+$/, '');
  const intFormatted = NL_INT.format(Number(intPart));
  const magnitude = decPart ? `${intFormatted},${decPart}` : intFormatted;
  return `${negative ? MINUS : ''}${magnitude}`;
}

/** @param {string} iso 'YYYY-MM-DD' @returns {string} '4 Jan 2021' */
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** @param {string} a @param {string} b @returns {string} '4 Jan 2021 to 7 Sep 2026' */
export function fmtDateRange(a, b) {
  return `${fmtDate(a)} to ${fmtDate(b)}`;
}

/** @param {number} n @returns {string} '2.073 days' */
export function fmtDays(n) {
  return `${NL_INT.format(Math.round(n))} days`;
}

/** Longer than this and the clock, not the sync, is what's wrong (rule 4: never
 * print a guess). A day is generously past the heavy-account estimate in
 * docs/07-DATA-ACCESS.md. */
const MAX_PLAUSIBLE_ELAPSED_MS = 24 * 60 * 60 * 1000;

/**
 * The one status line the app and the popup both show while a sync runs, so the
 * two never drift (US-154). `syncState` is `{ step, page, startedAt }` from
 * `meta.syncState`, echoed by sw.js's `status` handler; the step list comes from
 * config.js, which is pure data, so the popup does not pull in the sync engine. `startedAt` is the worker's clock, so
 * a negative or absurd gap between it and `now` is dropped instead of shown. Never
 * a percentage or a time-remaining estimate: the page count of a history endpoint
 * is unknown until its last page answers, and a forecast would be a guess.
 * @param {{step?:string, startedAt?:number}|null|undefined} syncState
 * @param {number} [now]
 * @returns {string|null} null when there is no step to report
 */
export function fmtSyncProgress(syncState, now = Date.now()) {
  if (!syncState || !syncState.step) return null;

  const idx = SYNC_STEPS.indexOf(syncState.step);
  const stepPart = idx === -1 ? null : `step ${idx + 1} of ${SYNC_STEPS.length}`;

  let elapsedPart = null;
  const { startedAt } = syncState;
  if (typeof startedAt === 'number' && Number.isFinite(startedAt)) {
    const elapsedMs = now - startedAt;
    if (elapsedMs >= 60000 && elapsedMs <= MAX_PLAUSIBLE_ELAPSED_MS) {
      elapsedPart = `${Math.floor(elapsedMs / 60000)} min`;
    }
  }

  const parts = [stepPart, elapsedPart].filter(Boolean);
  return parts.length ? `Syncing, ${parts.join(', ')}` : 'Syncing';
}

export { MASK };
