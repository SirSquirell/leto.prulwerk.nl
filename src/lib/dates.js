// Date arithmetic in UTC only. Every date in Leto is the string 'YYYY-MM-DD' in
// UTC, so a local time zone or a daylight saving change can never move a day.
// This module may not read the clock: `today` is passed in by the caller.

import { LetoError } from './errors.js';

const MS_PER_DAY = 86400000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A malformed date is a shape problem in the input, not a value to guess at. */
function reject(value, what) {
  throw new LetoError(
    'SHAPE_CHANGED',
    { endpoint: 'dates', field: what },
    `${what}: ${String(value)}`,
  );
}

/** @param {string} iso @returns {number} UTC milliseconds at midnight */
function utcMs(iso) {
  const parts = typeof iso === 'string' ? ISO_DATE.exec(iso) : null;
  if (!parts) return reject(iso, 'not an ISO date');
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (!Number.isFinite(ms) || format(ms) !== iso) return reject(iso, 'not a real date');
  return ms;
}

/** @param {number} ms @returns {string} */
function format(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch seconds (candle keys) to the UTC calendar day they fall in.
 * @param {number} epochSeconds @returns {string} ISODate */
export function toISODate(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) return reject(epochSeconds, 'not epoch seconds');
  return format(Math.trunc(epochSeconds) * 1000);
}

/** @param {string} iso @param {number} n @returns {string} ISODate */
export function addDays(iso, n) {
  if (!Number.isInteger(n)) return reject(n, 'not a whole number of days');
  return format(utcMs(iso) + n * MS_PER_DAY);
}

/** Whole days from a to b; negative when b precedes a.
 * @param {string} a @param {string} b @returns {number} */
export function daysBetween(a, b) {
  return Math.round((utcMs(b) - utcMs(a)) / MS_PER_DAY);
}

/** Inclusive list of days; empty when to precedes from.
 * @param {string} from @param {string} to @returns {string[]} */
export function range(from, to) {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  const start = utcMs(from);
  const out = new Array(span + 1);
  for (let i = 0; i <= span; i += 1) out[i] = format(start + i * MS_PER_DAY);
  return out;
}

/** The UTC day an instant falls in. Accepts a bare date unchanged.
 * @param {string} isoDateTime @returns {string} ISODate */
export function fromDateTime(isoDateTime) {
  if (typeof isoDateTime !== 'string') return reject(isoDateTime, 'not a date-time');
  if (ISO_DATE.test(isoDateTime)) return format(utcMs(isoDateTime));
  const ms = Date.parse(isoDateTime);
  if (!Number.isFinite(ms)) return reject(isoDateTime, 'not a date-time');
  return format(ms);
}
