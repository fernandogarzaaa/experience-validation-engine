/**
 * Continuous UX regression — track experience across a *series* of builds and
 * detect where it is improving, regressing, or holding steady. Where
 * `compareExperience` (src/regression) compares two sessions, this operates on
 * an ordered sequence of population studies (build 1 → build N) and turns each
 * tracked metric into a trend with a direction and a slope.
 */

import type { PopulationStudy } from "../population/population.js";

/** Metrics tracked across builds, with the direction of "good". */
export const TREND_METRICS = [
  { key: "successRate", label: "Success rate", higherIsBetter: true },
  { key: "dropoffRate", label: "Drop-off rate", higherIsBetter: false },
  { key: "overallScore", label: "Overall score", higherIsBetter: true },
  { key: "confidence", label: "Confidence", higherIsBetter: true },
  { key: "frustration", label: "Frustration", higherIsBetter: false },
  { key: "trust", label: "Trust", higherIsBetter: true },
  { key: "medianSteps", label: "Median steps to complete", higherIsBetter: false },
] as const;

export type TrendMetricKey = (typeof TREND_METRICS)[number]["key"];

export type TrendDirection = "improved" | "regressed" | "stable";

export interface MetricTrend {
  readonly metric: TrendMetricKey;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly series: readonly number[];
  readonly first: number;
  readonly last: number;
  /** last − first (raw, not direction-adjusted). */
  readonly delta: number;
  /** Least-squares slope per build. */
  readonly slope: number;
  readonly direction: TrendDirection;
}

export interface BuildSnapshot {
  readonly label: string;
  readonly metrics: Readonly<Record<TrendMetricKey, number>>;
}

export interface TrendReport {
  readonly builds: readonly string[];
  readonly trends: readonly MetricTrend[];
  readonly regressions: readonly MetricTrend[];
  readonly improvements: readonly MetricTrend[];
  readonly verdict: "improving" | "regressing" | "mixed" | "stable";
  readonly summary: string;
  readonly generatedAt: string;
}

/** Extract the tracked metrics from a population study. */
export function metricsFromStudy(study: PopulationStudy): Record<TrendMetricKey, number> {
  return {
    successRate: study.successRate,
    dropoffRate: study.dropoffRate,
    overallScore: study.overallScore.mean,
    confidence: study.confidence.mean,
    frustration: study.frustration.mean,
    trust: study.trust.mean,
    medianSteps: study.stepsToComplete.median,
  };
}

/** Relative threshold below which a change is treated as noise (stable). */
const STABLE_EPSILON = 0.02;

function slopeOf(series: readonly number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = series.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (i - meanX) * (series[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function directionOf(first: number, last: number, higherIsBetter: boolean): TrendDirection {
  const scale = Math.max(Math.abs(first), Math.abs(last), 1e-9);
  const rel = (last - first) / scale;
  if (Math.abs(rel) < STABLE_EPSILON) return "stable";
  const better = higherIsBetter ? last > first : last < first;
  return better ? "improved" : "regressed";
}

const round = (v: number, p = 3): number => Math.round(v * 10 ** p) / 10 ** p;

/**
 * Analyze a trend across an ordered series of build snapshots (oldest first).
 * Accepts either raw snapshots or population studies.
 */
export function analyzeTrends(
  builds: readonly (BuildSnapshot | { label: string; study: PopulationStudy })[],
): TrendReport {
  if (builds.length < 2) {
    throw new Error("analyzeTrends needs at least two builds to compare.");
  }
  const snapshots: BuildSnapshot[] = builds.map((b) =>
    "study" in b ? { label: b.label, metrics: metricsFromStudy(b.study) } : b,
  );

  const trends: MetricTrend[] = TREND_METRICS.map(({ key, label, higherIsBetter }) => {
    const series = snapshots.map((s) => s.metrics[key]);
    const first = series[0]!;
    const last = series[series.length - 1]!;
    return {
      metric: key,
      label,
      higherIsBetter,
      series: series.map((v) => round(v)),
      first: round(first),
      last: round(last),
      delta: round(last - first),
      slope: round(slopeOf(series), 4),
      direction: directionOf(first, last, higherIsBetter),
    };
  });

  const regressions = trends.filter((t) => t.direction === "regressed");
  const improvements = trends.filter((t) => t.direction === "improved");

  let verdict: TrendReport["verdict"];
  if (regressions.length && improvements.length) verdict = "mixed";
  else if (regressions.length) verdict = "regressing";
  else if (improvements.length) verdict = "improving";
  else verdict = "stable";

  const summary =
    `${builds.length} builds analyzed: ${improvements.length} metric(s) improved, ` +
    `${regressions.length} regressed, ` +
    `${trends.length - improvements.length - regressions.length} stable. Verdict: ${verdict}.`;

  return {
    builds: snapshots.map((s) => s.label),
    trends,
    regressions,
    improvements,
    verdict,
    summary,
    generatedAt: new Date().toISOString(),
  };
}
