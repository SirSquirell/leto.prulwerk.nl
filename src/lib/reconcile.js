// The acceptance test of the whole history: does the reconstruction agree with the
// figures Trading 212 reports for the same account, today?
//
// Rule 6: off by a cent means the history is wrong. There is no tolerance
// parameter. Pure: engine result and broker rows in, a typed verdict out.

/** Quantities are carried to eight decimals (A21); a difference smaller than that
 *  is a printing artefact, not a holding. */
const QTY_TOLERANCE = 1e-8;

/** A close-to-close move this large is not a market move, it is a corporate
 *  action the ledger has not been told about. */
const SPLIT_JUMP = 0.4;

/** The largest numerator and denominator a split ratio may have. */
const MAX_TERM = 20;

/** A quantity ratio may miss a rational by this much and still be it. */
const RATIO_SLACK = 0.01;

function num(value) {
  return Number.isFinite(value) ? value : 0;
}

/** The simplest `n/m` with terms up to MAX_TERM that the ratio is within 1% of,
 * excluding 1:1, which is what agreement looks like and never a split.
 * @param {number} ratio @returns {{n:number, m:number}|null} */
function asRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  let best = null;
  for (let m = 1; m <= MAX_TERM; m += 1) {
    for (let n = 1; n <= MAX_TERM; n += 1) {
      if (n === m) continue;
      if (Math.abs(ratio - n / m) > RATIO_SLACK * ratio) continue;
      const weight = n + m;
      if (best === null || weight < best.weight) best = { n, m, weight };
    }
  }
  return best === null ? null : { n: best.n, m: best.m };
}

/** The instrument's own close per day, recovered from the value it was given:
 * value = qty · close / fx, so close = value · fx / qty. Days it was not held
 * yield null, because a value of zero says nothing about a price. */
function closes(history) {
  const out = new Array(history.qty.length).fill(null);
  for (let i = 0; i < history.qty.length; i += 1) {
    const qty = history.qty[i];
    const fx = history.fx[i];
    const value = history.value[i];
    if (!(qty > QTY_TOLERANCE) || !Number.isFinite(fx) || !Number.isFinite(value)) continue;
    if (value === 0) continue;
    out[i] = (value * fx) / qty;
  }
  return out;
}

/** The days this instrument's close jumped further than a market can. */
function jumpDays(history, days) {
  const price = closes(history);
  const out = [];
  let previous = null;
  for (let i = 0; i < price.length; i += 1) {
    if (price[i] === null) continue;
    if (previous !== null && previous > 0) {
      const change = price[i] / previous - 1;
      if (Math.abs(change) > SPLIT_JUMP) out.push(days[i]);
    }
    previous = price[i];
  }
  return out;
}

/**
 * @param {import('./types.js').PortfolioResult} result
 * @param {import('./types.js').Position[]} positions the broker's own holdings
 * @param {import('./types.js').Summary|null} summary the broker's own total
 * @returns {import('./types.js').Reconciliation}
 */
export function reconcile(result, positions, summary) {
  const days = result?.days ?? [];
  const n = days.length;
  const engineValue = n ? result.value[n - 1] : 0;
  const broker = new Map();
  for (const position of positions ?? []) {
    if (!position || !position.ticker) continue;
    broker.set(position.ticker, num(position.quantity));
  }
  const engine = new Map(Object.entries(result?.positionsToday ?? {}));

  const quantityDeltas = [];
  const suspectedSplits = [];
  for (const ticker of [...new Set([...engine.keys(), ...broker.keys()])].sort()) {
    const mine = num(engine.get(ticker));
    const theirs = num(broker.get(ticker));
    if (Math.abs(mine - theirs) <= QTY_TOLERANCE) continue;
    quantityDeltas.push({ ticker, engine: mine, broker: theirs });

    // The quantity ratio says what the split was; a price jump says when.
    const history = result.byInstrument?.[ticker];
    if (!history || !(mine > QTY_TOLERANCE) || !(theirs > QTY_TOLERANCE)) continue;
    const ratio = asRatio(theirs / mine);
    if (!ratio) continue;
    for (const date of jumpDays(history, days)) {
      suspectedSplits.push({ ticker, date, ratio: `${ratio.n}:${ratio.m}` });
    }
  }

  // No anchor is not agreement (US-05 AC3).
  if (!summary || !Number.isFinite(summary.total)) {
    return { status: 'UNVERIFIED', deltaValue: null, quantityDeltas, suspectedSplits };
  }

  const deltaValue = engineValue - summary.total;
  let status = 'OK';
  if (quantityDeltas.length) {
    // The ledger is wrong; the prices are beside the point until it is fixed.
    status = 'QUANTITY_MISMATCH';
  } else if (Math.round(engineValue * 100) !== Math.round(summary.total * 100)) {
    status = 'VALUE_MISMATCH';
  }
  return { status, deltaValue, quantityDeltas, suspectedSplits };
}
