/**
 * Composition (US-30 to US-33). The stack in currency and in percent from the
 * same series with the same colours, the largest position today against its peak,
 * the two-date table, and currency exposure when more than one currency carries
 * value. Colour follows the instrument's rank over the whole history, so changing
 * the period never repaints a series.
 */

const CASH_KEY = 'Cash';

function instrumentOf(model, ticker) {
  const list = model.instruments;
  if (!list) return null;
  if (Array.isArray(list)) return list.find((row) => row && row.ticker === ticker) || null;
  return list[ticker] || null;
}

function shortName(model, ticker) {
  const instrument = instrumentOf(model, ticker);
  if (!instrument) return ticker;
  return instrument.shortName || instrument.name || ticker;
}

/** The layers of the stack, bottom first, each with the colour of its rank. */
function layersOf(composition, model, ui, percent) {
  const ranking = Array.isArray(composition.ranking) ? composition.ranking : [];
  const layers = (composition.series || []).map((series, index) => {
    const rank = ranking.indexOf(series.ticker);
    return {
      key: ui.safeLabel(series.ticker),
      ticker: series.ticker,
      label: ui.safeLabel(shortName(model, series.ticker)),
      values: percent ? series.weight : series.value,
      fill: ui.slotColour(rank >= 0 ? rank : index),
    };
  });
  if (composition.other) {
    const count = composition.other.count || [];
    const peak = count.length ? Math.max(...count.map((n) => Number(n) || 0)) : 0;
    layers.push({
      key: `Other (${peak})`,
      ticker: null,
      label: `Other (${peak})`,
      values: percent ? composition.other.weight : composition.other.value,
      fill: ui.slotColour(layers.length),
    });
  }
  if (composition.cash) {
    layers.push({
      key: CASH_KEY,
      ticker: null,
      label: CASH_KEY,
      values: percent ? composition.cash.weight : composition.cash.value,
      fill: ui.token('--cash'),
    });
  }
  return layers;
}

function windowOf(composition, slice) {
  const days = composition.days || [];
  const from = Math.max(0, days.indexOf(slice.days[0]));
  const toRaw = days.indexOf(slice.days[slice.days.length - 1]);
  const to = toRaw < 0 ? days.length - 1 : toRaw;
  return { from, to: Math.max(from, to) };
}

function cut(values, from, to) {
  return (values || []).slice(from, to + 1).map((value) => (Number.isFinite(value) ? value : 0));
}

function points(delta) {
  if (!Number.isFinite(delta)) return '—';
  const pts = delta * 100;
  const sign = pts >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pts).toFixed(1)}`;
}

export function render(host, model, ui) {
  const { el, copy } = ui;
  const composition = model.composition;
  const slice = ui.slice();
  if (!composition || !Array.isArray(composition.days) || !composition.days.length || !slice) {
    host.appendChild(el('p', { class: 'why', text: 'No composition to show yet. Run a sync.' }));
    return;
  }

  const percent = ui.view.compositionMode === 'percent';
  const bounds = windowOf(composition, slice);
  const days = composition.days.slice(bounds.from, bounds.to + 1);
  const layers = layersOf(composition, model, ui, percent);

  const chart = ui.charts.stackedArea({
    days,
    layers: layers.map((layer) => ({
      key: layer.key,
      values: cut(layer.values, bounds.from, bounds.to),
      fill: layer.fill,
    })),
    width: 1000,
    height: 340,
    percent,
  });

  const todayIndex = composition.days.length - 1;
  let largest = null;
  for (const series of composition.series || []) {
    const share = Number(series.weight && series.weight[todayIndex]);
    if (Number.isFinite(share) && (!largest || share > largest.share)) {
      largest = { ticker: series.ticker, share, weights: series.weight };
    }
  }
  let peak = null;
  if (largest) {
    for (let i = 0; i < largest.weights.length; i += 1) {
      const share = Number(largest.weights[i]);
      if (Number.isFinite(share) && (!peak || share > peak.share)) {
        peak = { share, date: composition.days[i] };
      }
    }
  }

  const legend = el(
    'div',
    { class: 'legend' },
    layers
      .slice()
      .reverse()
      .map((layer) =>
        el(
          'span',
          { class: 'legend__item' },
          el('i', { class: 'swatch', style: `background: ${layer.fill}` }),
          layer.label,
        ),
      ),
  );

  const modeControl = ui.segmented(
    [
      { id: 'currency', label: `In ${model.currency || 'currency'}` },
      { id: 'percent', label: 'In percent' },
    ],
    ui.view.compositionMode,
    (id) => {
      ui.setView('compositionMode', id);
      ui.refresh();
    },
    'Composition unit',
  );

  const stackPanel = ui.panel(
    'Six largest, the rest bundled, cash on top',
    modeControl,
    ui.mountChart(chart, {
      money: !percent,
      label: percent
        ? 'Share of total value per instrument over time'
        : 'Value per instrument over time, stacked',
    }),
    el('p', {
      class: 'why',
      text: percent ? copy.CHART_NOTES.compositionPercent : copy.CHART_NOTES.compositionCurrency,
    }),
    legend,
  );

  const largestKpi = el(
    'div',
    { class: 'kpicol' },
    ui.kpi({
      figure: copy.FIGURES.largestPosition,
      head: true,
      value: largest ? ui.pct(largest.share) : '—',
      extra: largest
        ? `${shortName(model, largest.ticker)} today. Peak ${ui.pct(peak ? peak.share : NaN)} on ${
            peak ? ui.date(peak.date) : '—'
          }.`
        : 'No position carries value today.',
    }),
    ui.kpi({
      figure: copy.FIGURES.positionsHeld,
      value: String((composition.series || []).length + ((composition.other && 1) || 0)),
      extra: `${
        Object.keys((model.result && model.result.byInstrument) || {}).length
      } instruments ever held; ${
        Object.keys((model.result && model.result.positionsToday) || {}).length
      } open today.`,
    }),
  );

  /* ------------------------------------------------------- two dates */

  const firstDay = composition.days[0];
  const lastDay = composition.days[composition.days.length - 1];
  if (!ui.view.dateA || ui.view.dateA < firstDay || ui.view.dateA > lastDay) {
    ui.setView('dateA', slice.days[0]);
  }
  if (!ui.view.dateB || ui.view.dateB < firstDay || ui.view.dateB > lastDay) {
    ui.setView('dateB', lastDay);
  }

  const tableHost = el('div', { class: 'tablewrap' });
  /* The two-date table is always in weights: a share is the point of it. */
  const weightLayers = layersOf(composition, model, ui, true);

  function nearestIndex(date) {
    const days2 = composition.days;
    let index = days2.indexOf(date);
    if (index >= 0) return index;
    for (let i = days2.length - 1; i >= 0; i -= 1) if (days2[i] <= date) return i;
    return 0;
  }

  function fillTable() {
    const indexA = nearestIndex(ui.view.dateA);
    const indexB = nearestIndex(ui.view.dateB);
    const rows = weightLayers.map((layer) => {
      const a = Number(layer.values && layer.values[indexA]);
      const b = Number(layer.values && layer.values[indexB]);
      const weightA = Number.isFinite(a) ? a : null;
      const weightB = Number.isFinite(b) ? b : null;
      const held = (weightA || 0) > 0;
      const holds = (weightB || 0) > 0;
      let status = 'held';
      if (!held && holds) status = 'opened';
      else if (held && !holds) status = 'closed';
      return {
        name: el(
          'span',
          null,
          el('i', { class: 'swatch', style: `background: ${layer.fill}` }),
          ' ',
          layer.label,
        ),
        a: ui.pct(weightA === null ? NaN : weightA),
        b: ui.pct(weightB === null ? NaN : weightB),
        delta: el('span', {
          class: (weightB || 0) - (weightA || 0) > 0 ? 'pos' : null,
          text: points((weightB || 0) - (weightA || 0)),
        }),
        status:
          status === 'held'
            ? el('span', { class: 'sub', text: 'held' })
            : el('span', { class: 'tag', text: status }),
      };
    });
    tableHost.replaceChildren(
      ui.table({
        columns: [
          { key: 'name', label: 'Instrument' },
          { key: 'a', label: `A · ${ui.date(composition.days[indexA])}`, numeric: true },
          { key: 'b', label: `B · ${ui.date(composition.days[indexB])}`, numeric: true },
          { key: 'delta', label: 'Δ pts', numeric: true },
          { key: 'status', label: 'Status' },
        ],
        rows,
      }),
    );
  }

  const dateInput = (id, key, label) => {
    const input = el('input', {
      type: 'date',
      id,
      min: firstDay,
      max: lastDay,
      value: ui.view[key],
    });
    input.addEventListener('change', () => {
      if (!input.value) return;
      ui.setView(key, input.value);
      fillTable();
    });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), input);
  };

  const twoDates = ui.panel(
    'Two dates, side by side',
    el(
      'div',
      { class: 'actions' },
      dateInput('leto-date-a', 'dateA', 'Date A'),
      dateInput('leto-date-b', 'dateB', 'Date B'),
    ),
    tableHost,
    el('p', {
      class: 'why',
      text: 'Weights on each date, in points of total value. A position absent on one date shows 0.0% and says whether it was opened or closed.',
    }),
  );
  fillTable();

  /* --------------------------------------------------- currency exposure */

  const exposure = new Map();
  const byInstrument = (model.result && model.result.byInstrument) || {};
  const indexB = nearestIndex(ui.view.dateB);
  const resultIndex = (model.result.days || []).indexOf(composition.days[indexB]);
  for (const [ticker, history] of Object.entries(byInstrument)) {
    const value = Number(history.value && history.value[resultIndex >= 0 ? resultIndex : history.value.length - 1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const instrument = instrumentOf(model, ticker);
    const currency = (instrument && instrument.currency) || model.currency || 'EUR';
    exposure.set(currency, (exposure.get(currency) || 0) + value);
  }
  const cashValue = Number(
    model.result.cash && model.result.cash[resultIndex >= 0 ? resultIndex : model.result.cash.length - 1],
  );
  if (Number.isFinite(cashValue) && cashValue > 0) {
    const base = model.currency || 'EUR';
    exposure.set(base, (exposure.get(base) || 0) + cashValue);
  }

  let exposurePanel = null;
  if (exposure.size > 1) {
    const entries = [...exposure.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    const chartCcy = ui.charts.bars({
      labels: entries.map((entry) => ui.safeLabel(entry[0])),
      values: entries.map((entry) => entry[1]),
      fill: ui.token('--accent-fill'),
      width: 1000,
      height: 200,
    });
    exposurePanel = ui.panel(
      `Value by instrument currency, ${ui.date(composition.days[indexB])}`,
      null,
      ui.mountChart(chartCcy, { money: true, label: 'Value by instrument currency' }),
      el(
        'div',
        { class: 'expo' },
        entries.map((entry, index) =>
          el('span', {
            class: 'expo__part',
            style: `flex: ${entry[1] / (total || 1)} 0 0; background: ${ui.slotColour(index)}`,
            title: `${entry[0]}: ${ui.pct(entry[1] / (total || 1))}`,
          }),
        ),
      ),
      el(
        'div',
        { class: 'legend' },
        entries.map((entry, index) =>
          el(
            'span',
            { class: 'legend__item' },
            el('i', { class: 'swatch', style: `background: ${ui.slotColour(index)}` }),
            `${entry[0]} ${ui.pct(entry[1] / (total || 1))}`,
          ),
        ),
      ),
      el('p', {
        class: 'why',
        text: 'Converted to your account currency at the rate the engine used that day. A currency here is where the value sits, not where you are.',
      }),
    );
  }

  host.appendChild(el('div', { class: 'split' }, largestKpi, stackPanel));
  host.appendChild(twoDates);
  if (exposurePanel) host.appendChild(exposurePanel);
}
