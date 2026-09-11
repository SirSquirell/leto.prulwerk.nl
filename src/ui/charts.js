// SVG chart builders (US-20, US-21, US-30, US-31, US-33). Return strings, never
// touch the DOM: an artifact of the "engine is pure" rule extended to the UI charts,
// so a chart can be unit tested under node:test with no browser at all.
//
// Colours are passed in as CSS variable names ('var(--slot-1)') and used verbatim,
// so a chart never repaints when the theme changes. Text uses fill='var(--label)'
// and font-family var(--mono) at 11px (DESIGN-BRIEF.md). One y-axis per chart,
// always; `fromZero` says whether the axis was forced to include zero.

import { fmtDate } from './format.js';

const LABEL_STYLE = "fill='var(--label)' font-family='var(--mono)' font-size='11'";
const GRID_STROKE = "stroke='var(--line-2)'";

function round2(n) {
  return Math.round(n * 100) / 100;
}

function safe(n) {
  return Number.isFinite(n) ? n : 0;
}

/** x position for day index i of n on a chart of the given width. */
function scaleX(i, n, width) {
  if (n <= 1) return 0;
  return round2((i / (n - 1)) * width);
}

/** y position for a value in [min,max] on a chart of the given height, y=0 at the
 * top of the SVG (so a larger value is a smaller y). */
function scaleY(value, min, max, height) {
  if (!(max > min)) return round2(height / 2);
  return round2(height - ((safe(value) - min) / (max - min)) * height);
}

/** The calendar unit a day belongs to, for label de-duplication. */
function yearOf(day) {
  return day.slice(0, 4);
}
function monthOf(day) {
  return day.slice(0, 7);
}

/** Indices to place an x-axis label at: the first day of each unit ('year' or
 * 'month'), so labels never repeat and never overlap. */
function labelIndices(days, unit) {
  const keyOf = unit === 'month' ? monthOf : yearOf;
  const out = [];
  let last = null;
  for (let i = 0; i < days.length; i += 1) {
    const key = keyOf(days[i]);
    if (key !== last) {
      out.push(i);
      last = key;
    }
  }
  return out;
}

function xAxisUnit(days, xLabelEvery) {
  if (xLabelEvery === 'month') return 'month';
  if (xLabelEvery === 'year') {
    const span = days.length;
    return span < 400 ? 'month' : 'year';
  }
  return days.length < 400 ? 'month' : 'year';
}

function xLabelsSvg(days, width, height, xLabelEvery) {
  const unit = xAxisUnit(days, xLabelEvery);
  const indices = labelIndices(days, unit);
  const parts = [];
  for (const i of indices) {
    const x = scaleX(i, days.length, width);
    const text = unit === 'month' ? days[i].slice(0, 7) : days[i].slice(0, 4);
    parts.push(`<text x='${x}' y='${height - 4}' ${LABEL_STYLE} text-anchor='start'>${text}</text>`);
  }
  return parts.join('');
}

/** A step of 1, 2, 2.5 or 5 times a power of ten that yields about `count` ticks. */
function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Compact money-free axis label: 0, 250, 2.5k, 40k, 1.2M. Never a currency sign. */
function compactLabel(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}${trimZeros((abs / 1e6).toFixed(1))}M`;
  if (abs >= 1e3) return `${sign}${trimZeros((abs / 1e3).toFixed(1))}k`;
  return `${sign}${trimZeros(abs.toFixed(abs < 10 ? 1 : 0))}`;
}
const trimZeros = (t) => t.replace(/\.0$/, '');

function yTicksSvg(min, max, height, width, yTicks) {
  const parts = [];
  const step = niceStep(max - min, Math.max(1, yTicks));
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + 1e-9; value += step) {
    const y = scaleY(value, min, max, height);
    parts.push(`<line x1='0' y1='${y}' x2='${width}' y2='${y}' ${GRID_STROKE} />`);
    // The lowest tick shares the corner with the first x label; the axis note under the
    // chart says where the axis starts, so its label is left out.
    if (value > min + 1e-9) parts.push(`<text x='2' y='${round2(y - 2)}' ${LABEL_STYLE}>${compactLabel(value)}</text>`);
  }
  return parts.join('');
}

function svgWrap({ width, height, describe, body }) {
  const label = describe.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return `<svg role="img" aria-label="${label}" viewBox="0 0 ${width} ${height}" width="100%" `
    + `xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/**
 * A line chart, one or more series sharing one y-axis (US-20, US-21).
 *
 * @param {{ days:string[], series:Array<{values:number[], stroke:string, width?:number,
 *   fill?:string}>, width?:number, height?:number, fromZero?:boolean, yTicks?:number,
 *   xLabelEvery?:'year'|'month' }} opts
 * @returns {{ svg:string, describe:string, min:number, max:number, fromZero:boolean }}
 */
export function lineChart({
  days = [], series = [], width = 1000, height = 300, fromZero = true, yTicks = 4,
  xLabelEvery = 'year',
} = {}) {
  const n = days.length;
  let dataMin = Infinity;
  let dataMax = -Infinity;
  for (const line of series) {
    for (const value of line.values) {
      if (!Number.isFinite(value)) continue;
      if (value < dataMin) dataMin = value;
      if (value > dataMax) dataMax = value;
    }
  }
  if (!Number.isFinite(dataMin)) dataMin = 0;
  if (!Number.isFinite(dataMax)) dataMax = 0;
  let min = fromZero ? Math.min(0, dataMin) : dataMin;
  let max = Math.max(dataMax, min + (dataMax === dataMin ? 1 : 0));
  if (max === min) max = min + 1;

  const paths = series.map((line) => {
    const points = line.values.map((value, i) => [scaleX(i, n, width), scaleY(value, min, max, height)]);
    const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    const strokeWidth = line.width ?? 2;
    let out = `<path d='${d}' fill='none' stroke='${line.stroke}' stroke-width='${strokeWidth}' />`;
    if (line.fill && n > 0) {
      const baseline = scaleY(min, min, max, height);
      const areaD = `${d} L${points[points.length - 1][0]},${baseline} L${points[0][0]},${baseline} Z`;
      out = `<path d='${areaD}' fill='${line.fill}' stroke='none' />` + out;
    }
    return out;
  }).join('');

  const primary = series[0]?.values ?? [];
  let describe = 'Empty chart, no data.';
  if (n > 0 && primary.length === n) {
    let minIdx = 0;
    let maxIdx = 0;
    for (let i = 1; i < n; i += 1) {
      if (safe(primary[i]) < safe(primary[minIdx])) minIdx = i;
      if (safe(primary[i]) > safe(primary[maxIdx])) maxIdx = i;
    }
    describe = `Line chart from ${fmtDate(days[0])} to ${fmtDate(days[n - 1])}. `
      + `First ${round2(primary[0])} on ${fmtDate(days[0])}, last ${round2(primary[n - 1])} on ${fmtDate(days[n - 1])}, `
      + `minimum ${round2(primary[minIdx])} on ${fmtDate(days[minIdx])}, `
      + `maximum ${round2(primary[maxIdx])} on ${fmtDate(days[maxIdx])}.`;
  }

  const body = yTicksSvg(min, max, height, width, yTicks) + paths + xLabelsSvg(days, width, height, xLabelEvery);
  return { svg: svgWrap({ width, height, describe, body }), describe, min, max, fromZero };
}

/**
 * A stacked area chart, layers bottom to top in the given order (US-30, US-31).
 *
 * @param {{ days:string[], layers:Array<{key:string, values:number[], fill:string}>,
 *   width?:number, height?:number, percent?:boolean }} opts
 * @returns {{ svg:string, describe:string }}
 */
export function stackedArea({ days = [], layers = [], width = 1000, height = 300, percent = false } = {}) {
  const n = days.length;
  const totals = new Array(n).fill(0);
  for (const layer of layers) {
    for (let i = 0; i < n; i += 1) totals[i] += Math.max(0, safe(layer.values[i]));
  }

  /** cumulative[i][k] = sum of layers 0..k-1 on day i, in chart units. */
  const cumulative = layers.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const total = totals[i];
    const scale = percent && total > 0 ? 100 / total : 1;
    let running = 0;
    for (let k = 0; k < layers.length; k += 1) {
      const raw = Math.max(0, safe(layers[k].values[i]));
      const scaled = percent ? (total > 0 ? raw * scale : 0) : raw;
      cumulative[k][i] = { from: running, to: running + scaled };
      running += scaled;
    }
  }
  const axisMax = percent ? 100 : Math.max(1, ...totals);

  const paths = layers.map((layer, k) => {
    const top = [];
    const bottom = [];
    for (let i = 0; i < n; i += 1) {
      const x = scaleX(i, n, width);
      top.push([x, scaleY(cumulative[k][i].to, 0, axisMax, height)]);
      bottom.push([x, scaleY(cumulative[k][i].from, 0, axisMax, height)]);
    }
    const topD = top.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    const bottomD = bottom.slice().reverse().map(([x, y]) => `L${x},${y}`).join(' ');
    return `<path d='${topD} ${bottomD} Z' fill='${layer.fill}' stroke='none' />`;
  }).join('');

  const describe = n > 0
    ? `Stacked area chart from ${fmtDate(days[0])} to ${fmtDate(days[n - 1])} with ${layers.length} series`
      + `${percent ? ', shown as a percentage of total value per day' : ', shown in account currency'}.`
    : 'Empty chart, no data.';

  const body = yTicksSvg(0, axisMax, height, width, 4) + paths + xLabelsSvg(days, width, height, 'year');
  return { svg: svgWrap({ width, height, describe, body }), describe };
}

/**
 * A bar chart, negative values below the zero line (US-40's year table).
 *
 * @param {{ labels:string[], values:number[], fill:string, width?:number, height?:number }} opts
 * @returns {{ svg:string, describe:string }}
 */
export function bars({ labels = [], values = [], fill = 'var(--slot-1)', width = 1000, height = 300 } = {}) {
  const n = labels.length;
  let min = 0;
  let max = 0;
  for (const value of values) {
    const v = safe(value);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) max = min + 1;
  const zeroY = scaleY(0, min, max, height);
  const slot = n > 0 ? width / n : width;
  const barWidth = Math.max(1, slot * 0.6);

  const rects = values.map((value, i) => {
    const v = safe(value);
    const x = round2(i * slot + (slot - barWidth) / 2);
    const y = v >= 0 ? scaleY(v, min, max, height) : zeroY;
    const barHeight = Math.max(0, round2(Math.abs(scaleY(v, min, max, height) - zeroY)));
    return `<rect x='${x}' y='${y}' width='${round2(barWidth)}' height='${barHeight}' fill='${fill}' />`;
  }).join('');

  const zeroLine = `<line x1='0' y1='${zeroY}' x2='${width}' y2='${zeroY}' ${GRID_STROKE} />`;
  const labelsSvg = labels.map((text, i) => {
    const x = round2(i * slot + slot / 2);
    return `<text x='${x}' y='${height - 4}' ${LABEL_STYLE} text-anchor='middle'>${text}</text>`;
  }).join('');

  const describe = n > 0
    ? `Bar chart of ${n} categories from ${labels[0]} to ${labels[n - 1]}; `
      + `largest ${round2(max)}, smallest ${round2(min)}.`
    : 'Empty chart, no data.';

  const body = zeroLine + rects + labelsSvg;
  return { svg: svgWrap({ width, height, describe, body }), describe };
}
