// Periods, chained returns, annualised returns and drawdown (US-21, US-22, US-23).
// Pure: an engine result and a period name in, plain numbers out. No clock: `today`
// is always a parameter, never read here.

/** The six period buttons the top bar offers, in display order. */
export const PERIODS = Object.freeze(['1M', '3M', '6M', 'YTD', '1Y', 'ALL']);

const ANNUALISE_DAYS = 365.25;
/** A history shorter than this many elapsed days shows the period return only
 * (US-22 AC2): an annualised figure from a few weeks of data is noise dressed as a
 * rate. */
const MIN_ANNUALISE_DAYS = 365;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** `iso` shifted by `delta` whole months, the day of month clamped to the last day
 * of the resulting month (31 Jan minus one month is 28 or 29 Feb, never 3 Mar).
 * @param {string} iso @param {number} delta @returns {string} */
function shiftMonths(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const newY = Math.floor(total / 12);
  const newM = total - newY * 12; // 0-based, 0..11
  const lastDayOfMonth = new Date(Date.UTC(newY, newM + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfMonth);
  return `${newY}-${pad2(newM + 1)}-${pad2(day)}`;
}

/**
 * The first day of a period, never earlier than the history itself.
 * @param {string} period one of PERIODS
 * @param {string} today ISODate
 * @param {string} firstDay ISODate, the first day the history has
 * @returns {string} ISODate
 */
export function periodStart(period, today, firstDay) {
  let start;
  switch (period) {
    case '1M': start = shiftMonths(today, -1); break;
    case '3M': start = shiftMonths(today, -3); break;
    case '6M': start = shiftMonths(today, -6); break;
    case '1Y': start = shiftMonths(today, -12); break;
    case 'YTD': start = `${today.slice(0, 4)}-01-01`; break;
    case 'ALL': start = firstDay; break;
    default: start = firstDay;
  }
  return start < firstDay ? firstDay : start;
}

/**
 * The slice of a result's arrays that a period covers, plus the two indices a
 * caller needs to compute a return anchored on the day before the period started.
 *
 * @param {import('../lib/types.js').PortfolioResult} result
 * @param {string} period one of PERIODS
 * @param {string} today ISODate
 * @returns {{ days:string[], value:number[], paidIn:number[], netExternal:number[],
 *   pnl:number[], estimated:boolean[], startIndex:number, anchorIndex:number }}
 */
export function sliceResult(result, period, today) {
  const days = result?.days ?? [];
  if (!days.length) {
    return {
      days: [], value: [], paidIn: [], netExternal: [], pnl: [], estimated: [],
      startIndex: 0, anchorIndex: 0,
    };
  }
  const firstDay = days[0];
  const start = periodStart(period, today, firstDay);
  let startIndex = days.indexOf(start);
  if (startIndex === -1) {
    // Not an exact day in the history (should not happen once clamped to
    // firstDay, which is always day 0): fall back to the nearest day at or after.
    startIndex = days.findIndex((day) => day >= start);
    if (startIndex === -1) startIndex = days.length - 1;
  }
  const anchorIndex = startIndex > 0 ? startIndex - 1 : 0;
  return {
    days: days.slice(startIndex),
    value: (result.value ?? []).slice(startIndex),
    paidIn: (result.paidIn ?? []).slice(startIndex),
    netExternal: (result.netExternal ?? []).slice(startIndex),
    pnl: (result.pnl ?? []).slice(startIndex),
    estimated: (result.estimated ?? []).slice(startIndex),
    startIndex,
    anchorIndex,
  };
}

/**
 * The result over `[startIndex, endIndex]` inclusive: the sum of daily pnl (US-21
 * AC2), and the chained daily return, anchored implicitly on `value[startIndex-1]`
 * because that is what `pnl[startIndex]` is already computed against.
 *
 * @param {import('../lib/types.js').PortfolioResult} result
 * @param {number} startIndex @param {number} endIndex
 * @returns {{ resultAbs:number, resultPct:number|null }}
 */
export function periodReturn(result, startIndex, endIndex) {
  const value = result?.value ?? [];
  const pnl = result?.pnl ?? [];
  let resultAbs = 0;
  let chain = 1;
  let any = false;
  for (let t = Math.max(0, startIndex); t <= endIndex; t += 1) {
    const dayPnl = Number.isFinite(pnl[t]) ? pnl[t] : 0;
    resultAbs += dayPnl;
    const prior = t > 0 ? value[t - 1] : 0;
    if (Number.isFinite(prior) && prior > 0) {
      chain *= 1 + dayPnl / prior;
      any = true;
    }
  }
  return { resultAbs, resultPct: any ? chain - 1 : null };
}

/** The daily rate `d` for which the net present value of `flows` is zero, found by
 * bisection over `[-0.999999, 10]`. `null` when the search does not converge
 * (both bounds land on the same side, or a value along the way is not finite),
 * rather than returning a rate that does not mean anything.
 * @param {number[]} flows @returns {number|null} */
function irrDailyRate(flows) {
  const npv = (d) => {
    let total = 0;
    for (let t = 0; t < flows.length; t += 1) {
      const denom = (1 + d) ** t;
      if (!Number.isFinite(denom) || denom === 0) return NaN;
      total += flows[t] / denom;
    }
    return total;
  };
  // Bounds on the daily rate itself, not the annualised one: a daily rate outside
  // [-0.5, 1] is not a rate any real account produces, and letting the bracket run
  // wider makes (1+d)^t underflow to exactly zero for large t, which would divide
  // a nonzero flow by zero instead of failing the finite check below.
  let lo = -0.5;
  let hi = 1;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if ((fLo < 0) === (fHi < 0)) return null; // same sign: no root bracketed
  let mid = 0;
  for (let i = 0; i < 200; i += 1) {
    mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (fMid === 0 || (hi - lo) < 1e-12) break;
    if ((fLo < 0) === (fMid < 0)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return mid;
}

/**
 * Annualised return, money-weighted and time-weighted (US-22). Both `null` when
 * the history spans under a year: an annualised rate from a few weeks is not a
 * rate, it is an extrapolation dressed up as one.
 *
 * @param {import('../lib/types.js').PortfolioResult} result
 * @returns {{ moneyWeighted:number|null, timeWeighted:number|null }}
 */
export function annualised(result) {
  const days = result?.days ?? [];
  const n = days.length;
  const elapsed = n > 0 ? n - 1 : 0;
  if (n === 0 || elapsed < MIN_ANNUALISE_DAYS) {
    return { moneyWeighted: null, timeWeighted: null };
  }

  const { resultPct } = periodReturn(result, 0, n - 1);
  const timeWeighted = resultPct === null
    ? null
    : (1 + resultPct) ** (ANNUALISE_DAYS / n) - 1;

  const flows = new Array(n).fill(0);
  for (let t = 0; t < n; t += 1) flows[t] = -(Number.isFinite(result.netExternal?.[t]) ? result.netExternal[t] : 0);
  flows[n - 1] += Number.isFinite(result.value?.[n - 1]) ? result.value[n - 1] : 0;
  const dailyRate = irrDailyRate(flows);
  const moneyWeighted = dailyRate === null ? null : (1 + dailyRate) ** ANNUALISE_DAYS - 1;

  return {
    moneyWeighted: Number.isFinite(moneyWeighted) ? moneyWeighted : null,
    timeWeighted: Number.isFinite(timeWeighted) ? timeWeighted : null,
  };
}

/**
 * The deepest fall from a peak to a trough, measured on value with deposits and
 * withdrawals removed (US-23 AC1): `adjusted[t] = value[t] - paidIn[t]`, so a
 * withdrawal never reads as a crash.
 *
 * @param {import('../lib/types.js').PortfolioResult} result
 * @returns {{ depthAbs:number|null, depthPct:number|null, peakDate:string|null,
 *   troughDate:string|null }}
 */
export function drawdown(result) {
  const days = result?.days ?? [];
  const n = days.length;
  if (n === 0) return { depthAbs: null, depthPct: null, peakDate: null, troughDate: null };

  const adjusted = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const value = Number.isFinite(result.value?.[i]) ? result.value[i] : 0;
    const paidIn = Number.isFinite(result.paidIn?.[i]) ? result.paidIn[i] : 0;
    adjusted[i] = value - paidIn;
  }

  let peak = adjusted[0];
  let peakIdx = 0;
  let worstDepth = 0;
  let worstDepthPct = null;
  let bestPeakIdx = 0;
  let bestTroughIdx = 0;

  for (let i = 1; i < n; i += 1) {
    if (adjusted[i] > peak) {
      peak = adjusted[i];
      peakIdx = i;
    }
    const drop = adjusted[i] - peak;
    if (drop < worstDepth) {
      worstDepth = drop;
      bestPeakIdx = peakIdx;
      bestTroughIdx = i;
      // The percentage is of the account's value at the peak, not of the flow-adjusted
      // series: a fall of 2.000 on an account worth 80.000 is 2,5%, whatever was paid in.
      const peakValue = Number.isFinite(result.value?.[peakIdx]) ? result.value[peakIdx] : 0;
      worstDepthPct = peakValue > 0 ? drop / peakValue : null;
    }
  }

  return {
    depthAbs: worstDepth,
    depthPct: worstDepthPct,
    peakDate: days[bestPeakIdx],
    troughDate: days[bestTroughIdx],
  };
}
