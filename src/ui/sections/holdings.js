/**
 * Holdings (US-50, US-51, US-52). One row per instrument ever held: what was paid
 * in, what grew, what came back as dividends and what was realised on the way
 * out. The cost basis is walked from the raw fills with average cost, so a
 * doubled position and a position bought twice never read the same.
 */

/** Already inside Trade.fees (BUILD-PLAN, parsing rules); the rest of taxes[]
 * left the account once more and is added here once. */
const FEE_TAX_NAMES = new Set([
  'COMMISSION_TURNOVER',
  'TRANSACTION_FEE',
  'CURRENCY_CONVERSION_FEE',
  'FINRA_FEE',
  'PTM_LEVY',
]);

const CLOSED_QTY = 1e-9;

function instrumentOf(model, ticker) {
  const list = model.instruments;
  if (!list) return null;
  if (Array.isArray(list)) return list.find((row) => row && row.ticker === ticker) || null;
  return list[ticker] || null;
}

function extraCost(trade) {
  let extra = Number(trade.fees) || 0;
  for (const tax of trade.taxes || []) {
    if (!tax || FEE_TAX_NAMES.has(tax.name)) continue;
    extra += Number(tax.amount) || 0;
  }
  return extra;
}

/** Average-cost walk over one instrument's fills. Corporate actions move
 * quantity and no cash, so they change the average and never the cost. */
function walk(trades) {
  let quantity = 0;
  let cost = 0;
  let realised = 0;
  let costs = 0;
  let firstDate = null;
  for (const trade of trades) {
    const size = Math.abs(Number(trade.quantity) || 0);
    if (!firstDate) firstDate = trade.date;
    if (trade.kind === 'CORPORATE_ACTION') {
      quantity += trade.side === 'SELL' ? -size : size;
      continue;
    }
    const extra = extraCost(trade);
    costs += extra;
    if (trade.side === 'BUY') {
      cost += Math.abs(Number(trade.settled) || 0) + extra;
      quantity += size;
    } else {
      const average = quantity > CLOSED_QTY ? cost / quantity : 0;
      const costOut = average * Math.min(size, quantity > 0 ? quantity : size);
      const proceeds = Math.abs(Number(trade.settled) || 0) - extra;
      realised += proceeds - costOut;
      cost = Math.max(0, cost - costOut);
      quantity -= size;
    }
  }
  return { quantity, cost, realised, costs, firstDate };
}

function buildRows(model, ui) {
  const result = model.result;
  const byTicker = new Map();
  for (const trade of model.trades || []) {
    if (!trade || !trade.ticker) continue;
    if (!byTicker.has(trade.ticker)) byTicker.set(trade.ticker, []);
    byTicker.get(trade.ticker).push(trade);
  }
  for (const ticker of Object.keys(result.byInstrument || {})) {
    if (!byTicker.has(ticker)) byTicker.set(ticker, []);
  }

  const lastIndex = result.days.length - 1;
  const rows = [];
  for (const [ticker, trades] of byTicker.entries()) {
    trades.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    const walked = walk(trades);
    const history = (result.byInstrument || {})[ticker];
    const quantity = Number.isFinite(Number(result.positionsToday && result.positionsToday[ticker]))
      ? Number(result.positionsToday[ticker])
      : history
        ? Number(history.qty[lastIndex]) || 0
        : walked.quantity;
    const value = history ? Number(history.value[lastIndex]) || 0 : 0;
    const paidIn = walked.cost;
    const grown = value - paidIn;
    const bucket = (model.income && model.income.byInstrument && model.income.byInstrument[ticker]) || null;
    const instrument = instrumentOf(model, ticker);
    rows.push({
      ticker,
      name: (instrument && (instrument.shortName || instrument.name)) || ticker,
      precision: instrument && Number.isFinite(instrument.quantityPrecision)
        ? instrument.quantityPrecision
        : 8,
      quantity,
      value,
      paidIn,
      grown,
      grownPct: paidIn > 0 ? grown / paidIn : NaN,
      dividends: bucket ? Number(bucket.dividend.net) || 0 : 0,
      realised: walked.realised,
      firstDate: (history && history.firstDate) || walked.firstDate,
      open: Math.abs(quantity) > CLOSED_QTY,
    });
  }
  rows.sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker));
  void ui;
  return rows;
}

const SORTERS = {
  name: (row) => row.name.toLowerCase(),
  quantity: (row) => row.quantity,
  value: (row) => row.value,
  paidIn: (row) => row.paidIn,
  grown: (row) => row.grown,
  grownPct: (row) => (Number.isFinite(row.grownPct) ? row.grownPct : -Infinity),
  dividends: (row) => row.dividends,
  realised: (row) => row.realised,
  firstDate: (row) => row.firstDate || '',
  status: (row) => (row.open ? 1 : 0),
};

export function render(host, model, ui) {
  const { el, copy } = ui;
  if (!model.result || !Array.isArray(model.result.days) || !model.result.days.length) {
    host.appendChild(el('p', { class: 'why', text: 'No holdings yet. Run a sync.' }));
    return;
  }

  const all = buildRows(model, ui);
  const filter = ui.view.holdingsFilter || 'open';
  const rows = all.filter((row) => (filter === 'all' ? true : filter === 'open' ? row.open : !row.open));

  const sortKey = SORTERS[ui.view.holdingsSort] ? ui.view.holdingsSort : 'value';
  const direction = ui.view.holdingsDir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const left = SORTERS[sortKey](a);
    const right = SORTERS[sortKey](b);
    if (typeof left === 'string' || typeof right === 'string') {
      return String(left).localeCompare(String(right)) * direction;
    }
    return (left - right) * direction;
  });

  const openCount = all.filter((row) => row.open).length;
  const totals = rows.reduce(
    (sum, row) => ({
      value: sum.value + row.value,
      paidIn: sum.paidIn + row.paidIn,
      grown: sum.grown + row.grown,
      dividends: sum.dividends + row.dividends,
      realised: sum.realised + row.realised,
    }),
    { value: 0, paidIn: 0, grown: 0, dividends: 0, realised: 0 },
  );

  /** '34% paid in, 66% grown' as one line, US-50 AC2. */
  function reading(row) {
    if (!(row.value > 0)) {
      return row.open ? 'No value today.' : 'Closed; the result sits in realised.';
    }
    return `${ui.pct(row.paidIn / row.value)} paid in, ${ui.pct(row.grown / row.value)} grown.`;
  }

  const onsort = (key) => {
    if (!SORTERS[key]) return;
    if (ui.view.holdingsSort === key) {
      ui.setView('holdingsDir', ui.view.holdingsDir === 'asc' ? 'desc' : 'asc');
    } else {
      ui.setView('holdingsSort', key);
      ui.setView('holdingsDir', key === 'name' || key === 'firstDate' ? 'asc' : 'desc');
    }
    ui.refresh();
  };

  const holdingsTable = ui.table({
    sort: { key: sortKey, dir: ui.view.holdingsDir === 'asc' ? 'asc' : 'desc' },
    onsort,
    columns: [
      { key: 'name', label: 'Instrument', sortable: true },
      { key: 'quantity', label: 'Quantity', numeric: true, sortable: true },
      { key: 'value', label: 'Value', numeric: true, sortable: true },
      { key: 'paidIn', label: 'Paid in', numeric: true, sortable: true },
      { key: 'grown', label: 'Grown', numeric: true, sortable: true },
      { key: 'grownPct', label: 'Grown %', numeric: true, sortable: true },
      { key: 'dividends', label: 'Dividends', numeric: true, sortable: true },
      { key: 'realised', label: 'Realised', numeric: true, sortable: true },
      { key: 'firstDate', label: 'First bought', sortable: true },
      { key: 'status', label: 'Status', sortable: true },
    ],
    rows: rows.map((row) => ({
      name: el(
        'span',
        null,
        el('span', { text: row.name }),
        ' ',
        el('span', { class: 'sub', text: row.ticker }),
        el('br'),
        el('span', { class: 'sub', text: reading(row) }),
      ),
      quantity: ui.qty(row.quantity, row.precision),
      value: ui.money(row.value),
      paidIn: ui.money(row.paidIn),
      grown: el('span', {
        class: row.grown > 0 ? 'pos' : null,
        text: ui.money(row.grown, { sign: true }),
      }),
      grownPct: Number.isFinite(row.grownPct) ? ui.pct(row.grownPct, { sign: true }) : '—',
      dividends: ui.money(row.dividends),
      realised: el('span', {
        class: row.realised > 0 ? 'pos' : null,
        text: ui.money(row.realised, { sign: true }),
      }),
      firstDate: ui.date(row.firstDate),
      status: el('span', { class: row.open ? 'sub' : 'tag', text: row.open ? 'open' : 'closed' }),
    })),
    foot: [
      el(
        'tr',
        { class: 'total' },
        el('td', { text: `${rows.length} row(s)` }),
        el('td', { class: 'n', text: '' }),
        el('td', { class: 'n', text: ui.money(totals.value) }),
        el('td', { class: 'n', text: ui.money(totals.paidIn) }),
        el('td', { class: 'n', text: ui.money(totals.grown, { sign: true }) }),
        el('td', { class: 'n', text: '' }),
        el('td', { class: 'n', text: ui.money(totals.dividends) }),
        el('td', { class: 'n', text: ui.money(totals.realised, { sign: true }) }),
        el('td', { text: '' }),
        el('td', { text: '' }),
      ),
    ],
  });

  const kpis = el(
    'div',
    { class: 'kpicol' },
    ui.kpi({
      figure: copy.FIGURES.positionsHeld,
      head: true,
      value: String(openCount),
      extra: `${all.length} instruments ever held, ${all.length - openCount} closed.`,
    }),
    ui.kpi({
      figure: copy.FIGURES.costBasis,
      value: ui.money(all.filter((row) => row.open).reduce((sum, row) => sum + row.paidIn, 0)),
    }),
    ui.kpi({
      figure: copy.FIGURES.grownOpen,
      value: ui.money(all.filter((row) => row.open).reduce((sum, row) => sum + row.grown, 0), {
        sign: true,
      }),
    }),
    ui.kpi({
      figure: copy.FIGURES.dividendsNet,
      label: 'Dividends, all positions',
      value: ui.money(all.reduce((sum, row) => sum + row.dividends, 0)),
    }),
  );

  const filterControl = ui.segmented(
    [
      { id: 'open', label: 'Open' },
      { id: 'closed', label: 'Closed' },
      { id: 'all', label: 'All' },
    ],
    filter,
    (id) => {
      ui.setView('holdingsFilter', id);
      ui.refresh();
    },
    'Holdings filter',
  );

  host.appendChild(
    el(
      'div',
      { class: 'split' },
      kpis,
      ui.panel(
        'Every instrument ever held',
        filterControl,
        holdingsTable,
        el('p', { class: 'why', text: copy.FIGURES.costBasis.not }),
        el('p', {
          class: 'why why--not',
          text: 'Quantities are shown at the precision the instrument allows. Realised result is proceeds minus average cost minus the costs of the fills.',
        }),
      ),
    ),
  );
}
