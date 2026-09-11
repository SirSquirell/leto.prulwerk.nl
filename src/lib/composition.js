// What the account was made of, day by day, and how that changed between two
// days. Everything here reads the engine result and nothing else: no network, no
// browser API, no store, no clock. Nothing is rounded; the UI does that.

import { LetoError } from './errors.js';

/** A value nearer zero than this is not a holding. */
const VALUE_EPS = 1e-9;

/** The largest number of named lines a composition chart carries; the rest is
 *  summed into `Other`. */
const DEFAULT_TOP = 6;

/** The tickers of a result ordered by the largest value they ever reached, worth
 * most first, ties broken by ticker so the order never depends on input order.
 * @param {import('./types.js').PortfolioResult} result @returns {string[]} */
function rankByPeak(result) {
  const peaks = Object.entries(result.byInstrument).map(([ticker, history]) => {
    let peak = 0;
    for (const value of history.value) if (Number.isFinite(value) && value > peak) peak = value;
    return { ticker, peak };
  });
  peaks.sort((a, b) => (b.peak - a.peak) || (a.ticker < b.ticker ? -1 : 1));
  return peaks.map((row) => row.ticker);
}

/** A share of the day's total, or null when the total is not positive: a share of
 * nothing is undefined, not zero. */
function weigh(value, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  return value / total;
}

/**
 * The daily composition: one line per instrument up to `top`, one `Other` line for
 * the rest, and cash. The total each weight is taken against is the account value
 * of that day, so the weights of a day sum to 1 whenever that value is positive.
 *
 * @param {import('./types.js').PortfolioResult} result
 * @param {{ top?: number }} [options]
 * @returns {import('./types.js').Composition}
 */
export function buildComposition(result, { top = DEFAULT_TOP } = {}) {
  const days = result?.days ?? [];
  const n = days.length;
  const ranking = n ? rankByPeak(result) : [];
  const named = ranking.slice(0, Math.max(0, top));
  const rest = ranking.slice(Math.max(0, top));

  const series = named.map((ticker) => ({
    ticker,
    value: result.byInstrument[ticker].value.slice(),
    weight: new Array(n).fill(null),
  }));
  const other = {
    count: new Array(n).fill(0),
    value: new Array(n).fill(0),
    weight: new Array(n).fill(null),
  };
  const cash = { value: new Array(n).fill(0), weight: new Array(n).fill(null) };

  for (let i = 0; i < n; i += 1) {
    const total = result.value[i];
    let restValue = 0;
    let restCount = 0;
    for (const ticker of rest) {
      const value = result.byInstrument[ticker].value[i];
      if (!Number.isFinite(value)) continue;
      restValue += value;
      if (value > VALUE_EPS) restCount += 1;
    }
    other.value[i] = restValue;
    other.count[i] = restCount;
    other.weight[i] = weigh(restValue, total);
    cash.value[i] = result.cash[i];
    cash.weight[i] = weigh(result.cash[i], total);
    for (const line of series) line.weight[i] = weigh(line.value[i], total);
  }

  return { days, series, other, cash, ranking };
}

/** @param {import('./types.js').PortfolioResult} result @param {string} date */
function indexOfDay(result, date) {
  const i = result?.days?.indexOf(date) ?? -1;
  if (i === -1) {
    throw new LetoError(
      'SHAPE_CHANGED',
      { endpoint: 'composition', field: String(date) },
      `day not in the history: ${String(date)}`,
    );
  }
  return i;
}

/**
 * How the mix differs between two days. Only instruments held on one of the two
 * days appear. `deltaPts` is in percentage points and is null when either day has
 * no positive total, because there is no share to compare.
 *
 * @param {import('./types.js').PortfolioResult} result
 * @param {string} dateA @param {string} dateB
 * @returns {import('./types.js').CompositionDiff[]}
 */
export function compareDates(result, dateA, dateB) {
  const a = indexOfDay(result, dateA);
  const b = indexOfDay(result, dateB);
  const totalA = result.value[a];
  const totalB = result.value[b];

  const out = [];
  for (const ticker of rankByPeak(result)) {
    const history = result.byInstrument[ticker];
    const valueA = Number.isFinite(history.value[a]) ? history.value[a] : 0;
    const valueB = Number.isFinite(history.value[b]) ? history.value[b] : 0;
    const heldA = valueA > VALUE_EPS;
    const heldB = valueB > VALUE_EPS;
    if (!heldA && !heldB) continue;
    const weightA = weigh(valueA, totalA);
    const weightB = weigh(valueB, totalB);
    const deltaPts = weightA === null || weightB === null ? null : (weightB - weightA) * 100;
    let status = 'held';
    if (!heldA && heldB) status = 'opened';
    if (heldA && !heldB) status = 'closed';
    out.push({ ticker, weightA, weightB, deltaPts, status });
  }
  // Heaviest on the later day first, ties by ticker.
  out.sort((x, y) => ((y.weightB ?? -1) - (x.weightB ?? -1)) || (x.ticker < y.ticker ? -1 : 1));
  return out;
}
