/**
 * Small, dependency-free statistics helpers for aggregating a population of
 * simulated operators. Everything here is pure and deterministic so population
 * studies are as reproducible as the individual sessions that feed them.
 */

/** A five-number-ish summary of a numeric sample. */
export interface Distribution {
  readonly count: number;
  readonly mean: number;
  readonly stdDev: number;
  readonly min: number;
  readonly max: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
}

export interface HistogramBin {
  readonly label: string;
  readonly from: number;
  /** Upper edge (inclusive for the final bin, exclusive otherwise). */
  readonly to: number;
  readonly count: number;
  readonly share: number;
}

export interface Histogram {
  readonly bins: readonly HistogramBin[];
  readonly total: number;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Linear-interpolation quantile (the "R-7" method also used by NumPy's
 * default), on a copy sorted ascending. `q` is in [0, 1].
 */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const clamped = Math.min(1, Math.max(0, q));
  const pos = clamped * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const weight = pos - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** Summarize a numeric sample as a {@link Distribution} (values rounded). */
export function summarize(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, p25: 0, median: 0, p75: 0 };
  }
  return {
    count: values.length,
    mean: round(mean(values)),
    stdDev: round(stdDev(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    p25: round(quantile(values, 0.25)),
    median: round(quantile(values, 0.5)),
    p75: round(quantile(values, 0.75)),
  };
}

/**
 * Bucket `values` into fixed-width bins across [min, max]. Bins are
 * left-closed / right-open except the last, which is right-closed so the
 * maximum value lands in it.
 */
export function histogram(values: readonly number[], binCount = 6): Histogram {
  const total = values.length;
  if (total === 0) return { bins: [], total: 0 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return {
      total,
      bins: [{ label: `${round(min)}`, from: min, to: max, count: total, share: 1 }],
    };
  }
  const bins = Math.max(1, Math.floor(binCount));
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]! += 1;
  }
  return {
    total,
    bins: counts.map((count, i) => {
      const from = min + i * width;
      const to = i === bins - 1 ? max : min + (i + 1) * width;
      return {
        label: `${round(from)}–${round(to)}`,
        from: round(from),
        to: round(to),
        count,
        share: round(count / total, 3),
      };
    }),
  };
}

/**
 * Pearson correlation coefficient between two equal-length samples. Returns 0
 * for degenerate inputs (length < 2 or zero variance). Used by later phases
 * (human-calibration) but lives here with the other stats primitives.
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return 0;
  return round(num / Math.sqrt(dx2 * dy2), 4);
}
