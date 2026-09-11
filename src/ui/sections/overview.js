/**
 * Overview (US-20). One headline figure, three supporting figures, the value line
 * with paid in beneath it, and the year table. Every figure carries its period
 * line, what it measures and what it does not mean, all from copy.js.
 */

/** Calendar-year buckets over the whole history. Exported because Performance
 * draws the same years as bars and must not compute them a second way. */
export function yearBuckets(result, ui) {
  const days = result.days;
  const buckets = [];
  let index = 0;
  while (index < days.length) {
    const year = days[index].slice(0, 4);
    let end = index;
    while (end + 1 < days.length && days[end + 1].slice(0, 4) === year) end += 1;
    let inflow = 0;
    let outflow = 0;
    for (let i = index; i <= end; i += 1) {
      const flow = Number(result.netExternal[i]) || 0;
      if (flow > 0) inflow += flow;
      else outflow -= flow;
    }
    const returns = ui.periodReturn(result, index, end);
    buckets.push({
      year,
      startIndex: index,
      endIndex: end,
      opening: index > 0 ? Number(result.value[index - 1]) || 0 : 0,
      closing: Number(result.value[end]) || 0,
      inflow,
      outflow,
      resultAbs: returns.resultAbs,
      resultPct: returns.resultPct,
      partial: end === days.length - 1 && days[end].slice(5) !== '12-31',
    });
    index = end + 1;
  }
  return buckets.reverse();
}

/** The one sentence the data block ends with: does it reconcile, and how do we
 * know. Comes from the notice table, never worded here. */
function reconciliationSentence(model, ui) {
  const codes = ['RECONCILE_OK', 'RECONCILE_VALUE', 'RECONCILE_QUANTITY', 'RECONCILE_UNVERIFIED'];
  const found = (model.notices || []).find((notice) => codes.includes(notice.code));
  if (found) return ui.noticeText(found);
  const status = (model.reconciliation && model.reconciliation.status) || 'UNVERIFIED';
  const byStatus = {
    OK: 'RECONCILE_OK',
    VALUE_MISMATCH: 'RECONCILE_VALUE',
    QUANTITY_MISMATCH: 'RECONCILE_QUANTITY',
    UNVERIFIED: 'RECONCILE_UNVERIFIED',
  };
  return ui.noticeText({ code: byStatus[status] || 'RECONCILE_UNVERIFIED' });
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
  const totalValue = Number(slice.value[last]) || 0;
  const paidInNow = Number(result.paidIn[result.paidIn.length - 1]) || 0;
  const returns = ui.periodReturn(result, slice.startIndex, slice.startIndex + last);
  const fall = ui.guard(() => ui.periods.drawdown(slice), null) ||
    ui.guard(() => ui.periods.drawdown(result), null) ||
    { depthAbs: 0, depthPct: 0, peakDate: null, troughDate: null };

  const estimatedDays = slice.estimated
    ? slice.estimated.reduce((sum, flag) => sum + (flag ? 1 : 0), 0)
    : 0;
  const measured = slice.days.length ? 1 - estimatedDays / slice.days.length : 0;

  const kpis = el(
    'div',
    { class: 'kpicol' },
    ui.kpi({
      figure: copy.FIGURES.totalValue,
      value: ui.money(totalValue),
      head: true,
    }),
    ui.kpi({ figure: copy.FIGURES.paidIn, value: ui.money(paidInNow) }),
    ui.kpi({
      figure: copy.FIGURES.result,
      value: ui.money(returns.resultAbs, { sign: true }),
      positive: returns.resultAbs > 0,
      extra: `${ui.pct(returns.resultPct, { sign: true })} over ${String(
        ui.periodLabel,
      ).toLowerCase()}, ${ui.dateRange(slice.days[0], slice.days[last])}.`,
    }),
    ui.kpi({
      figure: copy.FIGURES.drawdown,
      value: ui.money(-Math.abs(Number(fall.depthAbs) || 0)),
      extra:
        fall.peakDate && fall.troughDate
          ? `${ui.pct(-Math.abs(Number(fall.depthPct) || 0))}, ${ui.dateRange(
              fall.peakDate,
              fall.troughDate,
            )}.`
          : 'No fall from a peak inside this period.',
    }),
    el(
      'div',
      { class: 'kpi kpi--last' },
      el('span', { class: 'lbl', text: copy.FIGURES.measured.label }),
      el('p', {
        class: 'why',
        text: `${ui.pct(measured)} measured · ${estimatedDays} of ${
          slice.days.length
        } days estimated · ${reconciliationSentence(model, ui)}`,
      }),
      el('p', { class: 'why why--not', text: copy.FIGURES.measured.not }),
    ),
  );

  const chart = ui.charts.lineChart({
    days: slice.days,
    series: [
      { values: slice.value, stroke: ui.token('--accent'), width: 2 },
      { values: slice.paidIn, stroke: ui.token('--label'), width: 1.5 },
    ],
    width: 1000,
    height: 330,
    fromZero: true,
  });

  const axisNote =
    chart && chart.fromZero === false
      ? copy.CHART_NOTES.axisNotFromZero(ui.money(chart.min))
      : copy.CHART_NOTES.axisFromZero;

  const buckets = yearBuckets(result, ui);
  const yearTable = ui.table({
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'opening', label: 'Opening', numeric: true },
      { key: 'in', label: 'In', numeric: true },
      { key: 'out', label: 'Out', numeric: true },
      { key: 'closing', label: 'Closing', numeric: true },
      { key: 'result', label: 'Result', numeric: true },
      { key: 'ret', label: 'Return', numeric: true },
    ],
    rows: buckets.map((bucket) => ({
      year: bucket.partial ? `${bucket.year} YTD` : bucket.year,
      opening: ui.money(bucket.opening),
      in: ui.money(bucket.inflow),
      out: ui.money(bucket.outflow),
      closing: ui.money(bucket.closing),
      result: el('span', {
        class: bucket.resultAbs > 0 ? 'pos' : null,
        text: ui.money(bucket.resultAbs, { sign: true }),
      }),
      ret: ui.pct(bucket.resultPct, { sign: true }),
    })),
  });

  const legend = el(
    'div',
    { class: 'legend' },
    el(
      'span',
      { class: 'legend__item' },
      el('i', { class: 'swatch swatch--line', style: `background: var(--accent)` }),
      'value',
    ),
    el(
      'span',
      { class: 'legend__item' },
      el('i', { class: 'swatch swatch--line', style: `background: var(--label)` }),
      'paid in',
    ),
  );

  host.appendChild(
    el(
      'div',
      { class: 'split' },
      kpis,
      ui.panel(
        `Value and paid in, ${model.currency || ''}`.trim(),
        legend,
        ui.mountChart(chart, {
          money: true,
          label: 'Account value over the period with paid in beneath it',
        }),
        el('p', { class: 'why', text: `${axisNote} ${copy.CHART_NOTES.valueLine}` }),
        yearTable,
      ),
    ),
  );
}
