// The one place a notice code becomes a sentence. Codes are the vocabulary the
// engine, the reconciliation and the sync speak; the table below is the only
// place they are worded, so a figure can never be shown without its caveat.
// This module may not compute anything and may not import a module that does.

import { LetoError } from './errors.js';

/** Severity order, worst first. @type {readonly string[]} */
export const LEVELS = Object.freeze(['error', 'warn', 'note', 'ok']);

/** @typedef {{ level:'error'|'warn'|'note'|'ok', text:string }} Notice */

/** @type {Readonly<Record<string, Notice>>} */
export const NOTICES = Object.freeze({
  KEY_INVALID: Object.freeze({
    level: 'error',
    text: 'The API key was refused. Make a new key in the Trading 212 app and paste it again.',
  }),
  KEY_SCOPE_MISSING: Object.freeze({
    level: 'error',
    text: 'The key lacks a read permission. Edit the key in the app and tick every read permission.',
  }),
  RATE_LIMITED: Object.freeze({
    level: 'warn',
    text: 'Trading 212 asked us to slow down; the sync will continue later.',
  }),
  UPSTREAM_ERROR: Object.freeze({
    level: 'error',
    text: 'Trading 212 returned an unexpected error. Try again later.',
  }),
  WRITE_FORBIDDEN: Object.freeze({
    level: 'error',
    text: 'A request that was not a read was blocked. Leto only ever reads (rule 1).',
  }),
  SHAPE_CHANGED: Object.freeze({
    level: 'error',
    text: 'A response from {endpoint} no longer has the field {field}. Figures that depend on it are hidden.',
  }),
  RECONCILE_QUANTITY: Object.freeze({
    level: 'error',
    text: 'Holdings differ from Trading 212 for {count} instrument(s). The history is wrong until this is resolved.',
  }),
  RECONCILE_VALUE: Object.freeze({
    level: 'error',
    text: 'The reconstructed total differs from Trading 212 by {delta}.',
  }),
  RECONCILE_UNVERIFIED: Object.freeze({
    level: 'warn',
    text: 'Trading 212 did not report a total; the history is unchecked.',
  }),
  RECONCILE_OK: Object.freeze({
    level: 'ok',
    text: 'The total matches Trading 212 to the cent.',
  }),
  CASH_UNKNOWN: Object.freeze({
    level: 'warn',
    text: '{count} cash row(s) of an unknown type were left out of the figures.',
  }),
  CASH_ALL_KNOWN: Object.freeze({
    level: 'ok',
    text: 'Every cash row was recognised.',
  }),
  DIVIDEND_TYPE_UNKNOWN: Object.freeze({
    level: 'warn',
    text: '{count} dividend(s) of an unknown type; credited as dividends.',
  }),
  UNKNOWN_INSTRUMENT: Object.freeze({
    level: 'warn',
    text: '{count} ticker(s) are not in the instrument list.',
  }),
  PRICE_SERIES_MISSING: Object.freeze({
    level: 'warn',
    text: 'No price history for {ticker}; valued at the last trade price.',
  }),
  FX_NO_RATE: Object.freeze({
    level: 'error',
    text: 'No exchange rate for {currency}; positions in it are excluded from the total.',
  }),
  FX_DERIVED: Object.freeze({
    level: 'note',
    text: '{count} exchange rate(s) were derived from settled amounts because the stated rate disagreed.',
  }),
  CORPORATE_ACTION_TAX: Object.freeze({
    level: 'warn',
    text: '{count} corporate action(s) on {ticker} carried a tax that no cash row paid; it was not counted.',
  }),
  QUANTITY_NEGATIVE: Object.freeze({
    level: 'error',
    text: '{ticker} was sold below the quantity held; the ledger is incomplete.',
  }),
  ESTIMATED_DAYS: Object.freeze({
    level: 'note',
    text: '{count} of {total} days use a carried-forward price.',
  }),
  SPLIT_SUSPECTED: Object.freeze({
    level: 'warn',
    text: '{ticker} looks like it split {ratio} on {date}.',
  }),
  SYNC_INCOMPLETE: Object.freeze({
    level: 'error',
    text: 'The last sync stopped at step {step}; figures are from the previous complete sync.',
  }),
  DEMO_DATA: Object.freeze({
    level: 'note',
    text: 'These are generated demo figures, not an account.',
  }),
  ACCOUNT_TYPE_UNSUPPORTED: Object.freeze({
    level: 'error',
    text: 'This account type is not served by the Trading 212 API.',
  }),
  CORPORATE_ACTION_CASH: Object.freeze({
    level: 'warn',
    text: '{count} corporate action(s) carried a cash amount and were treated as cash-neutral.',
  }),
  ORDERS_UNFILLED_SKIPPED: Object.freeze({
    level: 'note',
    text: '{count} order(s) without a fill (cancelled or rejected) were left out.',
  }),
  TX_FOREIGN_CURRENCY: Object.freeze({
    level: 'note',
    text: '{count} cash row(s) in another currency were converted at the day\'s rate.',
  }),
});

/** The sentence for a code with its placeholders filled in. A placeholder with
 * no value is left standing, so a missing value is visible instead of blank.
 * @param {string} code @param {Record<string, unknown>} [params] @returns {string} */
export function render(code, params = {}) {
  const notice = NOTICES[code];
  if (!notice) {
    throw new LetoError(
      'SHAPE_CHANGED',
      { endpoint: 'notices', field: String(code) },
      `unknown notice code: ${String(code)}`,
    );
  }
  return notice.text.replace(/\{(\w+)\}/g, (whole, name) => {
    const value = params[name];
    return value === undefined || value === null ? whole : String(value);
  });
}
