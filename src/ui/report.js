// The bug report (US-61). Built from an allowlist: codes, counts, a reconciliation
// status, a delta rounded to a class (never the amount), and `meta` filtered through
// store.js's own export gate. No ticker, no name, no amount, no quantity, no date of
// a trade, nothing from the credential. Pure: a model in, a text string out.

import { fmtPct } from './format.js';
import { redactMeta } from '../lib/store.js';

/** Every top-level line label this report may ever produce, in order. A reviewer
 * reading this file reads the whole shape of what can leave the machine. */
export const ALLOWED_FIELDS = Object.freeze([
  'Version',
  'Today',
  'Counts',
  'Reconciliation',
  'Estimated',
  'Notices',
  'Meta',
]);

/** A reconciliation delta rounded to a class, never the amount itself (rule 7):
 * '0' agrees to the cent, then order-of-magnitude bands. */
function deltaClass(deltaValue) {
  if (deltaValue === null || deltaValue === undefined || !Number.isFinite(deltaValue)) return 'n/a';
  const abs = Math.abs(deltaValue);
  if (Math.round(abs * 100) === 0) return '0';
  if (abs < 1) return '<1';
  if (abs < 100) return '<100';
  return '>=100';
}

function estimatedShare(result) {
  const days = result?.estimated ?? [];
  if (!days.length) return null;
  let count = 0;
  for (const day of days) if (day) count += 1;
  return count / days.length;
}

/**
 * @param {{ model: object, version: string }} args
 * @returns {string}
 */
export function buildReport({ model, version }) {
  const lines = [];
  lines.push('Leto bug report');
  lines.push(`Version: ${version}`);
  lines.push(`Today: ${model?.today ?? 'n/a'}`);

  const days = model?.result?.days?.length ?? 0;
  const instrumentCount = Object.keys(model?.instruments ?? {}).length;
  const tradeCount = (model?.trades ?? []).length;
  const dividendCount = (model?.dividends ?? []).length;
  const cashRowCount = (model?.cashRows ?? []).length;
  const priceSeriesCount = Object.keys(model?.prices ?? {}).length;
  lines.push(
    `Counts: instruments ${instrumentCount}, trades ${tradeCount}, `
    + `dividends ${dividendCount}, cash rows ${cashRowCount}, `
    + `price series ${priceSeriesCount}, days ${days}`,
  );

  const reconciliation = model?.reconciliation ?? {};
  lines.push(
    `Reconciliation: ${reconciliation.status ?? 'n/a'} `
    + `(delta class ${deltaClass(reconciliation.deltaValue)})`,
  );

  const share = estimatedShare(model?.result);
  lines.push(`Estimated: ${fmtPct(share)} of days`);

  lines.push('Notices:');
  const notices = model?.notices ?? [];
  if (!notices.length) {
    lines.push('- none');
  } else {
    for (const notice of notices) {
      lines.push(`- ${notice.code} ${notice.level} x${notice.count ?? 1}`);
    }
  }

  lines.push(`Meta: ${JSON.stringify(redactMeta(model?.meta ?? {}))}`);

  return lines.join('\n');
}
