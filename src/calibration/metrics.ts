/**
 * Research-grade metric primitives (Phase 11 calibration substrate).
 *
 * Small, pure, honestly-labeled functions for future trajectory comparison.
 * Each states its kind in its docstring:
 *
 * - descriptive: summarizes observed data, claims nothing beyond it.
 * - simulation-sample: computed over simulated operators, not humans.
 *
 * Do NOT present these as calibrated, validated, or human-grounded: they
 * are the vocabulary a future calibration objective can be written in,
 * not evidence of agreement. No thresholds, no verdicts, no scores.
 */

/** Fraction of human choices appearing in EVE's top-k ranked candidates. */
export function topKAgreement<T>(
  humanChoices: readonly T[],
  eveTopK: ReadonlyArray<readonly T[]>,
  equals: (a: T, b: T) => boolean = Object.is as (a: T, b: T) => boolean,
): number {
  if (humanChoices.length === 0 || humanChoices.length !== eveTopK.length) return 0;
  let hits = 0;
  for (let i = 0; i < humanChoices.length; i++) {
    if (eveTopK[i]!.some((c) => equals(c, humanChoices[i]!))) hits += 1;
  }
  return hits / humanChoices.length;
}

/**
 * Mean squared error between predicted probabilities and binary outcomes.
 * Lower is better; 0.25 is the no-information baseline. Requires REAL
 * model probabilities (utility softmax) — never synthesize inputs.
 */
export function brierScore(predicted: readonly number[], actual: readonly (0 | 1)[]): number {
  if (predicted.length === 0 || predicted.length !== actual.length) return NaN;
  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    const d = predicted[i]! - actual[i]!;
    sum += d * d;
  }
  return sum / predicted.length;
}

/** Rank the values (average ranks for ties), 1-based. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
    i = j + 1;
  }
  return out;
}

/**
 * Spearman rank correlation in [-1, 1]. Compares ORDERINGS (e.g. predicted
 * vs observed screen-friction ranks), never magnitudes. Null when
 * undefined (fewer than 2 points or zero variance).
 */
export function spearmanRankCorrelation(
  xs: readonly number[],
  ys: readonly number[],
): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mean = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/**
 * L1 distance between two transition distributions (maps of edge → count).
 * 0 = identical support and mass; 2 = disjoint. Descriptive only.
 */
export function transitionDivergenceL1(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (keys.size === 0) return 0;
  const sumA = [...a.values()].reduce((x, y) => x + y, 0) || 1;
  const sumB = [...b.values()].reduce((x, y) => x + y, 0) || 1;
  let dist = 0;
  for (const k of keys) dist += Math.abs((a.get(k) ?? 0) / sumA - (b.get(k) ?? 0) / sumB);
  return dist;
}

/**
 * Mean absolute log-duration error in natural-log units. Log scale because
 * human dwell times are heavy-tailed: being 2× off on a 30s dwell matters
 * like being 2× off on a 3s dwell. Non-positive durations are skipped
 * (explicit missing-data handling, not imputation).
 */
export function meanLogDurationError(
  predictedMs: readonly number[],
  actualMs: readonly number[],
): number | null {
  if (predictedMs.length !== actualMs.length) return null;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < predictedMs.length; i++) {
    const p = predictedMs[i]!;
    const a = actualMs[i]!;
    if (!(p > 0) || !(a > 0)) continue;
    sum += Math.abs(Math.log(p) - Math.log(a));
    n += 1;
  }
  return n > 0 ? sum / n : null;
}
