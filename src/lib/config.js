/**
 * Every URL, host, endpoint, limit and tuning constant. Pure data; nothing here runs.
 *
 * The endpoint table is the one place the Trading 212 API is described. Status per
 * entry follows docs/07-DATA-ACCESS.md: `documented` means read in the API docs,
 * `assumed` means taken from Asteria's August 2026 reading or the 2024 public schema
 * and awaiting the practice run (US-01). Rate limits are the stricter of the two
 * readings; the practice run may loosen them, never the code on its own.
 */

export const VERSION = '0.9.0';

export const HOSTS = Object.freeze({
  live: 'https://live.trading212.com',
  demo: 'https://demo.trading212.com',
  charting: 'https://live.services.trading212.com',
  site: 'https://leto.prulwerk.nl',
});

export const API_PREFIX = '/api/v0';

/**
 * From the OpenAPI bundle at docs.trading212.com/_bundle/api.json, read 2026-09-07
 * (docs/API-SPEC-NOTES.md). minMs is the documented minimum interval between two
 * requests to that path, with margin. paginated endpoints answer {items, nextPagePath}
 * and take cursor and limit (max 50). `scope` is the permission the 403 text names.
 */
export const ENDPOINTS = Object.freeze({
  summary: Object.freeze({ path: '/equity/account/summary', minMs: 5500, paginated: false, scope: 'account', status: 'documented' }),
  positions: Object.freeze({ path: '/equity/positions', minMs: 1100, paginated: false, scope: 'portfolio', status: 'documented' }),
  instruments: Object.freeze({ path: '/equity/metadata/instruments', minMs: 55000, paginated: false, scope: 'metadata', status: 'documented' }),
  exchanges: Object.freeze({ path: '/equity/metadata/exchanges', minMs: 33000, paginated: false, scope: 'metadata', status: 'documented' }),
  orders: Object.freeze({ path: '/equity/history/orders', minMs: 11000, paginated: true, scope: 'history:orders', status: 'documented' }),
  dividends: Object.freeze({ path: '/equity/history/dividends', minMs: 11000, paginated: true, scope: 'history:dividends', status: 'documented' }),
  transactions: Object.freeze({ path: '/equity/history/transactions', minMs: 11000, paginated: true, scope: 'history:transactions', status: 'documented' }),
});

/** Page size for paginated endpoints; the documented maximum. */
export const PAGE_LIMIT = 50;

/**
 * Every path Leto may ever request on the API hosts. The URL allowlist test (US-10)
 * asserts the adapter produces nothing outside this set and nothing but GET.
 */
export const READ_PATHS = Object.freeze(Object.values(ENDPOINTS).map((e) => e.path));

/** Public, unauthenticated. Measured by Asteria on 2026-08-11. */
export const OHLC = Object.freeze({
  path: '/charting/v1/eq/ohlc/ONE_DAY',
  size: 1000,
  minMs: 1100,
  status: 'measured',
});

/** Rate posture. Rule 5: account safety, not politeness. */
export const RATE = Object.freeze({
  hostFloorMs: 1100,
  maxRetries: 4,
  backoffBaseMs: 2000,
  backoffCapMs: 60000,
  deadlineMs: 30000,
});

/** Unattended sync gate. */
export const SYNC = Object.freeze({
  staleAfterMs: 24 * 60 * 60 * 1000,
  alarmName: 'leto-daily',
  alarmPeriodMinutes: 60,
  instrumentsMaxAgeMs: 24 * 60 * 60 * 1000,
});

/** The API exists only for Invest and Stocks ISA; the summary carries no type field,
 * so both are treated identically (ASSUMPTIONS.md A4). */
export const SUPPORTED_ACCOUNT_TYPES = Object.freeze(['INVEST', 'ISA']);

/** The one chrome.storage.local entry. keystore.js is its only reader and writer. */
export const CREDENTIAL_KEY = 'credential';

export const DB = Object.freeze({
  name: 'leto',
  version: 1,
  stores: Object.freeze({
    instruments: 'ticker',
    positions: 'ticker',
    summary: 'key',
    orders: 'id',
    dividends: 'id',
    transactions: 'id',
    prices: 'ticker',
    meta: 'key',
  }),
});

/** How many categorical chart slots before "Other". */
export const COMPOSITION_TOP = 6;
