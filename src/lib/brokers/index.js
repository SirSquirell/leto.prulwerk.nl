/**
 * The broker boundary.
 *
 * Everything broker-specific lives behind one of these. Nothing above it (engine,
 * composition, income, reconcile, the UI) may name a broker. Member names follow
 * Asteria's contract where the meaning is the same so either project can host the
 * other's adapter; the session pair is replaced by a credential pair because Leto
 * reads an API (ADR-007).
 *
 * The shape:
 *
 *   id       'trading212'                stable storage prefix
 *   label    'Trading 212'               what the UI shows
 *   hosts    { live, demo, charting }    for the manifest and the throttle
 *
 *   checkCredential({cred})                       -> {ok, account:{type, currency}} | {ok:false, code}
 *   fetchInstruments({cred})                      -> raw
 *   fetchPositions({cred})                        -> raw
 *   fetchCash({cred})                             -> raw
 *   fetchSummary({cred})                          -> raw
 *   fetchOrders({cred, cursor})                   -> raw   {items, nextPagePath}
 *   fetchDividends({cred, cursor})                -> raw
 *   fetchTransactions({cred, cursor})             -> raw
 *   fetchPrices({ticker, to})                     -> raw   public, no credential
 *
 *   parseInstruments(raw)  -> Record<ticker, Instrument>
 *   parsePositions(raw)    -> Position[]
 *   parseCash(raw)         -> partial Summary
 *   parseSummary(raw)      -> Summary
 *   parseOrders(raw)       -> Trade[]
 *   parseDividends(raw)    -> Dividend[]        each carries a category
 *   parseTransactions(raw) -> CashRow[]         each carries a category
 *   parsePrices(raw, ticker) -> PriceSeries
 *
 *   explain(code, error)   -> a sentence someone can act on
 *
 * `cred` is produced by keystore.js and consumed by net.js. An adapter reads only
 * `cred.env` to pick the live or practice host; key and secret are read by net.js
 * alone. There is no `login`: a credential is pasted by the user, never obtained by
 * code (CLAUDE.md rule 1).
 */

import * as trading212 from './trading212.js';

export const ADAPTERS = Object.freeze([trading212]);

export const byId = (id) => ADAPTERS.find((a) => a.id === id) ?? null;

export const REQUIRED = Object.freeze([
  'id',
  'label',
  'hosts',
  'checkCredential',
  'fetchInstruments',
  'fetchPositions',
  'fetchCash',
  'fetchSummary',
  'fetchOrders',
  'fetchDividends',
  'fetchTransactions',
  'fetchPrices',
  'parseInstruments',
  'parsePositions',
  'parseCash',
  'parseSummary',
  'parseOrders',
  'parseDividends',
  'parseTransactions',
  'parsePrices',
  'explain',
]);

/** The conformance check; the failure is a list of names, not a TypeError mid-sync. */
export function missingMembers(adapter) {
  return REQUIRED.filter((k) => adapter?.[k] == null);
}
