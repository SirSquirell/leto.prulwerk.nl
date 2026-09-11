/**
 * Performance (US-21, US-22, US-23). Result over the selected period, the two
 * annualised rates with what each one is not, yearly result as bars, and a month
 * grid of the two most recent years. Every number is a sum of daily pnl, never a
 * derived figure read back as an input (rule 2).
 */

import { yearBuckets } from './overview.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Σ pnl per 'YYYY-MM'. */
function monthTotals(result) {
  const totals = new Map();
  for (let i = 0; i < result.days.length; i += 1) {
    const key = result.days[i].slice(0, 7);
    totals.set(key, (totals.get(key) || 0) + (Number(result.pnl[i]) || 0));
  }
  return totals;
}

export function render(host, model, ui) {
  const { el, copy } = ui;
  const result = model.result;
  const slice = ui.slice();
  if (!slice || !slice.days.length) {
    host.appendChild(el('p', { class: 'why', text: 'No days to show yet. Run a sync.' }));
    return;
  }

  const last = slice.days.length - 1;
  const returns = ui.periodReturn(result, slice.startIndex, slice.startIndex + last);
  const underAYear = result.days.length < 365;
  const rates = underAYear
    ? { moneyWeighted: null, timeWeighted: null }
    : ui.guard(() => ui.periods.annualised(result), { moneyWeighted: null, timeWeighted: null });

  const annualisedKpi = (figure, value) =>
    ui.kpi({
      figure,
      value: Number.isFinite(value) ? ui.pct(value, { sign: true }) : '—',
      extra: underAYear
        ? `The history is ${ui.days(result.days.length)}. ${copy.FIGURES.resultPct.not}`
        : null,
    });

  const kpis = el(
    'div',
    { class: 'kpicol' },
    ui.kpi({
      figure: copy.FIGURES.result,
      value: ui.money(returns.resultAbs, { sign: true }),
      positive: returns.resultAbs > 0,
      head: true,
    }),
    ui.kpi({
      figure: copy.FIGURES.resultPct,
      value: ui.pct(returns.resultPct, { sign: true }),
      positive: returns.resultPct > 0,
      extra: `${ui.dateRange(slice.days[0], slice.days[last])}, ${ui.days(slice.days.length)}.`,
    }),
    annualisedKpi(copy.FIGURES.moneyWeighted, rates && rates.moneyWeighted),
    annualisedKpi(copy.FIGURES.timeWeighted, rates && rates.timeWeighted),
  );

  const buckets = yearBuckets(result, ui).slice().reverse();
  const barChart = ui.charts.bars({
    labels: buckets.map((bucket) => ui.safeLabel(bucket.year)),
    values: buckets.map((bucket) => bucket.resultAbs),
    fill: ui.token('--accent-fill'),
    width: 1000,
    height: 240,
  });

  const yearTable = ui.table({
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'result', label: 'Result', numeric: true },
      { key: 'ret', label: 'Return, chained', numeric: true },
    ],
    rows: buckets
      .slice()
      .reverse()
      .map((bucket) => ({
        year: bucket.partial ? `${bucket.year} YTD` : bucket.year,
        result: el('span', {
          class: bucket.resultAbs > 0 ? 'pos' : null,
          text: ui.money(bucket.resultAbs, { sign: true }),
        }),
        ret: ui.pct(bucket.resultPct, { sign: true }),
      })),
  });

  const totals = monthTotals(result);
  const years = [...new Set(result.days.map((day) => day.slice(0, 4)))].slice(-2).reverse();
  const monthGrid = el(
    'div',
    { class: 'tablewrap' },
    el(
      'div',
      { class: 'months' },
      el(
        'div',
        { class: 'months__row' },
        el('span', null, ''),
        MONTHS.map((month) => el('span', { class: 'months__head', text: month })),
      ),
      years.map((year) =>
        el(
          'div',
          { class: 'months__row' },
          el('span', { class: 'months__year', text: year }),
          MONTHS.map((month, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`;
            const has = totals.has(key);
            const value = totals.get(key) || 0;
            return el('span', {
              class: `months__cell${!has ? ' months__cell--empty' : ''}${
                has && value > 0 ? ' months__cell--pos' : ''
              }`,
              text: has ? ui.money(value, { sign: true }) : '—',
              title: has ? `${key}: ${ui.money(value, { sign: true })}` : `${key}: no data`,
            });
          }),
        ),
      ),
    ),
  );

  host.appendChild(
    el(
      'div',
      { class: 'split' },
      kpis,
      el(
        'div',
        { style: 'display: flex; flex-direction: column; gap: 18px; min-width: 0;' },
        ui.panel(
          'Result per calendar year',
          null,
          ui.mountChart(barChart, { money: true, label: 'Result per calendar year' }),
          el('p', { class: 'why', text: copy.CHART_NOTES.axisFromZero }),
          yearTable,
        ),
        ui.panel(
          'Result per month, the two most recent years',
          null,
          monthGrid,
          el('p', { class: 'why', text: copy.FIGURES.result.not }),
        ),
      ),
    ),
  );
}
