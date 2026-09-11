/**
 * Every sentence the app shows under a figure or a chart. One place, so the tone stays
 * one tone and a reviewer can read the whole product's voice in a minute. Each figure
 * has a `label`, an `is` (what it measures) and a `not` (what it does not mean). No
 * marketing, no exclamation marks, no advice.
 */

export const FIGURES = Object.freeze({
  totalValue: {
    label: 'Total value, today',
    is: 'Positions at the last close plus cash, in your account currency.',
    not: 'Not what you would get if you sold everything today; spreads and fees are not in it.',
  },
  paidIn: {
    label: 'Paid in',
    is: 'Deposits minus withdrawals over the whole history.',
    not: 'Never counted as gain. A deposit moves value, not result.',
  },
  result: {
    label: 'Result',
    is: 'What the account earned over the selected period, chained day by day.',
    not: 'A deposit inside the period does not flatter it; a withdrawal does not hurt it.',
  },
  resultPct: {
    label: 'Return',
    is: 'Result as a share of what you had paid in, over the period.',
    not: 'Not an annual rate unless the period is one year.',
  },
  drawdown: {
    label: 'Deepest fall',
    is: 'The largest drop from a peak to a trough in value, deposits and withdrawals excluded.',
    not: 'A withdrawal is not a crash and is not counted here.',
  },
  moneyWeighted: {
    label: 'Annualised, money-weighted',
    is: 'The yearly rate that turns your deposits and withdrawals, timed as you made them, into today\'s value.',
    not: 'Not comparable with an index: it rewards or punishes your timing.',
  },
  timeWeighted: {
    label: 'Annualised, time-weighted',
    is: 'The yearly rate of the portfolio itself, as if no money had moved in or out.',
    not: 'Not what you personally earned; that is the money-weighted figure.',
  },
  dividendsNet: {
    label: 'Dividends received',
    is: 'Net dividends credited to cash over the period.',
    not: 'Not part of the price result; it sits beside it on the Income page.',
  },
  dividendsWithheld: {
    label: 'Withheld at source',
    is: 'Gross dividend minus what arrived, per payment.',
    not: 'Estimated when the payout currency differs from your account currency.',
  },
  fees: {
    label: 'Fees',
    is: 'Commission, transaction fees, FX conversion fees and exchange levies on fills.',
    not: 'Not stamp duty or transaction taxes; those are listed as taxes.',
  },
  taxes: {
    label: 'Transaction taxes',
    is: 'Stamp duty, stamp duty reserve tax, French transaction tax and similar, per fill.',
    not: 'Not dividend withholding tax; that is under Income.',
  },
  interest: {
    label: 'Interest on cash',
    is: 'Interest Trading 212 paid on uninvested cash.',
    not: 'Not a return on your investments; it is income on cash.',
  },
  lending: {
    label: 'Share lending income',
    is: 'Your share of the lending interest on shares lent out.',
    not: 'Not a dividend; dividends on lent shares arrive as manufactured payments.',
  },
  totalCost: {
    label: 'Total cost of the account',
    is: 'Fees, transaction taxes and withheld dividend tax added up, per year.',
    not: 'Not the spread you paid on each trade; that is invisible in the data.',
  },
  costBasis: {
    label: 'Paid in, open positions',
    is: 'Cost basis of what is still held: average cost of the shares, fees included.',
    not: 'Not the same as deposits. Money that went into positions you later sold is not in it.',
  },
  grownOpen: {
    label: 'Grown, open positions',
    is: 'Value today minus the cost basis of the same positions.',
    not: 'Unrealised. Dividends and closed positions are counted elsewhere.',
  },
  largestPosition: {
    label: 'Largest position',
    is: 'The biggest holding as a share of total value today, and its peak share ever.',
    not: 'Not a judgement. Concentration is a fact about your data.',
  },
  positionsHeld: {
    label: 'Positions held',
    is: 'Open positions today, and how many instruments you ever held.',
    not: 'Cash is not a position.',
  },
  measured: {
    label: 'Measured',
    is: 'Share of days valued with an actual closing price for every holding.',
    not: 'Estimated days carry the last known close forward; weekends are estimated by nature.',
  },
});

export const PERIODS = Object.freeze({
  '1M': 'Last month',
  '3M': 'Last three months',
  '6M': 'Last six months',
  YTD: 'This year so far',
  '1Y': 'Last year',
  ALL: 'Whole history',
});

export const SECTIONS = Object.freeze([
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'composition', label: 'Composition' },
  { id: 'income', label: 'Income and cost' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'tax', label: 'Tax' },
  { id: 'notices', label: 'Notices' },
]);

export const CHART_NOTES = Object.freeze({
  axisFromZero: 'Axis starts at zero.',
  axisNotFromZero: (min) => `Axis does not start at zero. Bottom is ${min}.`,
  compositionCurrency:
    'Stacked in your account currency. A band that widens can be a bigger position or a portfolio that grew as a whole.',
  compositionPercent:
    'Share of total value per day, summing to 100%. Colour follows the instrument, ranked once over the whole history, so changing the period never repaints a series.',
  valueLine: 'Value with paid in beneath it. The gap between them is the result.',
});

export const FIRST_RUN = Object.freeze({
  title: 'Before the first sync',
  body: [
    'Leto will read your Trading 212 account through its official API with the read-only key you paste here: your positions, your order history, your dividends, your cash movements, and public price history.',
    'It does this one request at a time and stores the results only in this browser. Nothing is sent anywhere but to Trading 212.',
    'Leto cannot place, change or cancel an order, and your key should not allow it either: tick only the read permissions when you create it in the app under Settings, API.',
    'You can revoke the key in the Trading 212 app at any time, and wipe everything here with one button. Trading 212 did not make this and is not affiliated with it.',
  ],
  proceed: 'Connect',
  demo: 'Open the demo instead',
});

export const TAX_DISCLAIMER =
  'These are your own figures, computed from your own data. They are not tax advice and not the tax you owe. Check them against the statements Trading 212 issues before you file.';
