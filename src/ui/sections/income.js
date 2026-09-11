/**
 * Income and cost (US-40 to US-43). Dividends gross, withheld and net per
 * instrument, per year and per month; costs in their own categories per year;
 * interest and lending beside them; one total cost per year with its parts. Every
 * figure comes from income.js, which reads the raw rows, never engine output.
 */

/** The tax names the adapter already summed into Trade.fees (BUILD-PLAN, parsing
 * rules). Listing them again here is what lets the page show a cost once. */
const FEE_TAX_NAMES = new Set([
  'COMMISSION_TURNOVER',
  'TRANSACTION_FEE',
  'CURRENCY_CONVERSION_FEE',
  'FINRA_FEE',
  'PTM_LEVY',
]);

const EMPTY = {
  dividend: { gross: 0, withheld: 0, net: 0, count: 0 },
  fees: 0,
  taxes: {},
  fxFees: 0,
  interest: 0,
  lending: 0,
  totalCost: 0,
};

function bucketOf(record, key) {
  const bucket = record && record[key];
  return bucket || EMPTY;
}

/** Groups the raw tax names into the five categories US-41 asks for. */
function taxCategory(name) {
  if (FEE_TAX_NAMES.has(name)) return 'FEE';
  if (name.includes('STAMP_DUTY')) return 'STAMP_DUTY';
  if (name.includes('TRANSACTION_TAX')) return 'TRANSACTION_TAX';
  return 'OTHER_TAX';
}

function categorise(bucket) {
  const out = { STAMP_DUTY: 0, TRANSACTION_TAX: 0, OTHER_TAX: 0 };
  for (const [name, amount] of Object.entries(bucket.taxes || {})) {
    const category = taxCategory(name);
    if (category === 'FEE') continue;
    out[category] += Number(amount) || 0;
  }
  return out;
}

function shortName(model, ticker) {
  const list = model.instruments;
  const instrument = Array.isArray(list)
    ? list.find((row) => row && row.ticker === ticker)
    : list && list[ticker];
  if (!instrument) return ticker;
  return instrument.shortName || instrument.name || ticker;
}

function estimatedTickers(model) {
  const set = new Set();
  for (const dividend of model.dividends || []) {
    if (dividend && dividend.withheldEstimated) set.add(dividend.ticker);
  }
  return set;
}

export function render(host, model, ui) {
  const { el, copy } = ui;
  const income = model.income;
  if (!income || !income.total) {
    host.appendChild(el('p', { class: 'why', text: 'No income rows yet. Run a sync.' }));
    return;
  }

  const total = income.total;
  const years = Object.keys(income.byYear || {}).sort().reverse();
  const months = Object.keys(income.byMonth || {}).sort().reverse();
  const estimated = estimatedTickers(model);
  const anyEstimated = estimated.size > 0;
  const rate = (bucket) =>
    bucket.dividend.gross > 0 ? bucket.dividend.withheld / bucket.dividend.gross : NaN;

  const kpis = el(
    'div',
    { class: 'kpicol' },
    ui.kpi({
      figure: copy.FIGURES.dividendsNet,
      head: true,
      value: ui.money(total.dividend.net),
      extra: `${total.dividend.count} payment(s) over the whole history.`,
    }),
    ui.kpi({
      figure: copy.FIGURES.dividendsWithheld,
      value: ui.money(total.dividend.withheld),
      extra: `${ui.pct(rate(total))} of gross${
        anyEstimated ? ', partly estimated through a currency conversion' : ''
      }.`,
    }),
    ui.kpi({
      figure: copy.FIGURES.totalCost,
      value: ui.money(total.totalCost),
      extra: `Fees ${ui.money(total.fees)}, of which FX ${ui.money(total.fxFees)}.`,
    }),
    ui.kpi({
      figure: copy.FIGURES.interest,
      value: ui.money(total.interest),
      extra: `Share lending added ${ui.money(total.lending)}.`,
    }),
  );

  /* --------------------------------------------- dividends per instrument */

  const instrumentRows = Object.keys(income.byInstrument || {})
    .map((ticker) => ({ ticker, bucket: income.byInstrument[ticker] }))
    .filter((row) => row.bucket && row.bucket.dividend && row.bucket.dividend.count > 0)
    .sort((a, b) => b.bucket.dividend.net - a.bucket.dividend.net);

  const perInstrument = ui.table({
    columns: [
      { key: 'name', label: 'Instrument' },
      { key: 'gross', label: 'Gross', numeric: true },
      { key: 'withheld', label: 'Withheld', numeric: true },
      { key: 'net', label: 'Net', numeric: true },
      { key: 'rate', label: 'Rate', numeric: true },
      { key: 'count', label: 'Payments', numeric: true },
    ],
    rows: instrumentRows.map((row) => ({
      name: el(
        'span',
        null,
        shortName(model, row.ticker),
        ' ',
        el('span', { class: 'sub', text: row.ticker }),
        estimated.has(row.ticker) ? ' ' : null,
        estimated.has(row.ticker)
          ? el('span', { class: 'tag tag--warn', text: 'withheld estimated' })
          : null,
      ),
      gross: ui.money(row.bucket.dividend.gross),
      withheld: ui.money(row.bucket.dividend.withheld),
      net: ui.money(row.bucket.dividend.net),
      rate: ui.pct(rate(row.bucket)),
      count: String(row.bucket.dividend.count),
    })),
    foot: [
      el(
        'tr',
        { class: 'total' },
        el('td', { text: 'Total' }),
        el('td', { class: 'n', text: ui.money(total.dividend.gross) }),
        el('td', { class: 'n', text: ui.money(total.dividend.withheld) }),
        el('td', { class: 'n', text: ui.money(total.dividend.net) }),
        el('td', { class: 'n', text: ui.pct(rate(total)) }),
        el('td', { class: 'n', text: String(total.dividend.count) }),
      ),
    ],
  });

  const perYearDividends = ui.table({
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'gross', label: 'Gross', numeric: true },
      { key: 'withheld', label: 'Withheld', numeric: true },
      { key: 'net', label: 'Net', numeric: true },
      { key: 'count', label: 'Payments', numeric: true },
    ],
    rows: years.map((year) => {
      const bucket = bucketOf(income.byYear, year);
      return {
        year,
        gross: ui.money(bucket.dividend.gross),
        withheld: ui.money(bucket.dividend.withheld),
        net: ui.money(bucket.dividend.net),
        count: String(bucket.dividend.count),
      };
    }),
  });

  const latestYear = years[0];
  const latestMonths = months.filter((month) => month.startsWith(`${latestYear}-`)).reverse();
  const perMonthDividends = latestMonths.length
    ? ui.table({
        caption: `Per month, ${latestYear}`,
        columns: [
          { key: 'month', label: 'Month' },
          { key: 'net', label: 'Dividends, net', numeric: true },
          { key: 'interest', label: 'Interest', numeric: true },
          { key: 'lending', label: 'Lending', numeric: true },
        ],
        rows: latestMonths.map((month) => {
          const bucket = bucketOf(income.byMonth, month);
          return {
            month,
            net: ui.money(bucket.dividend.net),
            interest: ui.money(bucket.interest),
            lending: ui.money(bucket.lending),
          };
        }),
      })
    : null;

  /* ------------------------------------------------------- costs per year */

  const costTable = ui.table({
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'fees', label: 'Fees', numeric: true },
      { key: 'fx', label: 'FX fees', numeric: true },
      { key: 'stamp', label: 'Stamp duty', numeric: true },
      { key: 'txtax', label: 'Transaction tax', numeric: true },
      { key: 'other', label: 'Other tax', numeric: true },
      { key: 'withheld', label: 'Withheld dividend tax', numeric: true },
      { key: 'totalCost', label: 'Total cost', numeric: true },
    ],
    rows: years.map((year) => {
      const bucket = bucketOf(income.byYear, year);
      const parts = categorise(bucket);
      return {
        year,
        fees: ui.money(bucket.fees),
        fx: ui.money(bucket.fxFees),
        stamp: ui.money(parts.STAMP_DUTY),
        txtax: ui.money(parts.TRANSACTION_TAX),
        other: ui.money(parts.OTHER_TAX),
        withheld: ui.money(bucket.dividend.withheld),
        totalCost: ui.money(bucket.totalCost),
      };
    }),
    foot: [
      el(
        'tr',
        { class: 'total' },
        el('td', { text: 'Whole history' }),
        el('td', { class: 'n', text: ui.money(total.fees) }),
        el('td', { class: 'n', text: ui.money(total.fxFees) }),
        el('td', { class: 'n', text: ui.money(categorise(total).STAMP_DUTY) }),
        el('td', { class: 'n', text: ui.money(categorise(total).TRANSACTION_TAX) }),
        el('td', { class: 'n', text: ui.money(categorise(total).OTHER_TAX) }),
        el('td', { class: 'n', text: ui.money(total.dividend.withheld) }),
        el('td', { class: 'n', text: ui.money(total.totalCost) }),
      ),
    ],
  });

  const taxNames = Object.keys(total.taxes || {}).sort();
  const taxByName = taxNames.length
    ? ui.table({
        caption: 'Taxes by the name Trading 212 uses',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'category', label: 'Category' },
          { key: 'amount', label: 'Whole history', numeric: true },
        ],
        rows: taxNames.map((name) => ({
          name,
          category: el('span', { class: 'sub', text: taxCategory(name) }),
          amount: ui.money(Number(total.taxes[name]) || 0),
        })),
      })
    : null;

  const interestTable = ui.table({
    columns: [
      { key: 'year', label: 'Year' },
      { key: 'interest', label: 'Interest on cash', numeric: true },
      { key: 'lending', label: 'Share lending', numeric: true },
    ],
    rows: years.map((year) => {
      const bucket = bucketOf(income.byYear, year);
      return {
        year,
        interest: ui.money(bucket.interest),
        lending: ui.money(bucket.lending),
      };
    }),
    foot: [
      el(
        'tr',
        { class: 'total' },
        el('td', { text: 'Whole history' }),
        el('td', { class: 'n', text: ui.money(total.interest) }),
        el('td', { class: 'n', text: ui.money(total.lending) }),
      ),
    ],
  });

  host.appendChild(
    el(
      'div',
      { class: 'split' },
      kpis,
      ui.panel(
        'Dividends per instrument',
        anyEstimated ? el('span', { class: 'tag tag--warn', text: 'withheld estimated' }) : null,
        perInstrument,
        el('p', { class: 'why', text: copy.FIGURES.dividendsWithheld.not }),
      ),
    ),
  );
  host.appendChild(
    el(
      'div',
      { class: 'grid3' },
      ui.panel('Dividends per year', null, perYearDividends),
      perMonthDividends ? ui.panel('Dividends and other income per month', null, perMonthDividends) : null,
      ui.panel(
        'Income that is not a dividend',
        null,
        interestTable,
        el('p', { class: 'why', text: copy.FIGURES.interest.not }),
        el('p', { class: 'why why--not', text: copy.FIGURES.lending.not }),
      ),
    ),
  );
  host.appendChild(
    ui.panel(
      'Cost of the account per year',
      null,
      costTable,
      el('p', { class: 'why', text: copy.FIGURES.totalCost.not }),
      el('p', {
        class: 'why why--not',
        text: 'Commission, transaction fee, currency conversion, FINRA and PTM levy are inside Fees, so nothing is counted twice.',
      }),
      taxByName,
    ),
  );
}
