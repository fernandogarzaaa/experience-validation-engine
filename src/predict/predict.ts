/**
 * Predictive UX — extrapolate from a simulated population to what the broader
 * user base will experience, with confidence intervals. Predicts future
 * confusion, abandonment, onboarding failure, support contacts, and
 * accessibility issues.
 *
 * Proportion predictions use the Wilson score interval (better than the normal
 * approximation at small n and near 0/1), treating the simulated population as
 * a sample. Modeled rates (support contacts) carry an explicit heuristic band.
 */

import type { PopulationStudy, OperatorRun } from "../population/population.js";

export type PredictionBasis = "observed-proportion" | "modeled";

export interface UXPredictionItem {
  readonly metric: string;
  /** Point estimate (a proportion in [0,1], or a rate when `unit` says so). */
  readonly estimate: number;
  readonly low: number;
  readonly high: number;
  readonly unit: "proportion" | "per-100-users";
  readonly basis: PredictionBasis;
  readonly note: string;
}

export interface PredictedStruggle {
  readonly screen: string;
  readonly predictedConfusion: number;
  readonly reason: string;
}

export interface UXPrediction {
  /** The study's target URL (identity — unchanged by display labels). */
  readonly url: string;
  /** Human-facing target name for report headers. Optional — renderers fall
   * back to `url`, so pre-existing consumers/constructors are unaffected. */
  readonly label?: string;
  readonly size: number;
  readonly predictions: readonly UXPredictionItem[];
  readonly struggleForecasts: readonly PredictedStruggle[];
  readonly generatedAt: string;
}

const round = (v: number, p = 3): number => Math.round(v * 10 ** p) / 10 ** p;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Wilson score interval for a binomial proportion (z = 1.96 → 95%). */
export function wilsonInterval(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: clamp01((center - margin) / denom), high: clamp01((center + margin) / denom) };
}

/** Build an observed-proportion prediction with a 95% Wilson interval. */
function proportion(
  metric: string,
  successes: number,
  n: number,
  note: string,
): UXPredictionItem {
  const ci = wilsonInterval(successes, n);
  return {
    metric,
    estimate: n ? round(successes / n) : 0,
    low: round(ci.low),
    high: round(ci.high),
    unit: "proportion",
    basis: "observed-proportion",
    note: `${note} (n=${n}, 95% CI)`,
  };
}

/** Short, human-facing screen name (last path segment). */
function shortName(screen: string): string {
  const cleaned = screen.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return cleaned.split(/[/:]/).filter(Boolean).at(-1) ?? screen;
}

const isFirstTimer = (op: OperatorRun): boolean => /first-?time|new-?user|onboard/i.test(op.persona);
const isAccessibility = (op: OperatorRun): boolean => /accessib|elderly|low-?vision|screen-?reader/i.test(op.persona);
const isConfused = (op: OperatorRun): boolean =>
  op.segment === "confused-wanderers" || op.emotions.confusion >= 0.5;

/**
 * Predict the UX the wider user base will experience from a population study.
 */
export function predictUX(study: PopulationStudy): UXPrediction {
  const ops = study.operators;
  const n = ops.length;

  const abandoned = ops.filter((o) => o.abandoned).length;
  const confused = ops.filter(isConfused).length;

  const predictions: UXPredictionItem[] = [
    proportion("Abandonment rate", abandoned, n, "Users predicted to churn before finishing"),
    proportion("Confusion rate", confused, n, "Users predicted to get lost or disoriented"),
  ];

  const firstTimers = ops.filter(isFirstTimer);
  if (firstTimers.length) {
    const failures = firstTimers.filter((o) => !o.completed).length;
    predictions.push(
      proportion("Onboarding failure rate", failures, firstTimers.length, "First-time users predicted to fail to activate"),
    );
  }

  const a11yOps = ops.filter(isAccessibility);
  const a11yFindings = study.topFindings.filter((f) => f.category === "accessibility" || f.category === "visual");
  if (a11yOps.length) {
    const failures = a11yOps.filter((o) => !o.completed).length;
    predictions.push(
      proportion("Accessibility-barrier rate", failures, a11yOps.length, "Accessibility-sensitive users predicted to hit a barrier"),
    );
  } else if (a11yFindings.length) {
    const worst = a11yFindings.reduce((m, f) => Math.max(m, f.prevalence), 0);
    predictions.push({
      metric: "Accessibility-barrier rate",
      estimate: round(worst),
      low: round(worst * 0.7),
      high: round(Math.min(1, worst * 1.3)),
      unit: "proportion",
      basis: "modeled",
      note: `Modeled from the most prevalent accessibility/visual finding (${a11yFindings.length} recurring).`,
    });
  }

  // Modeled support-contact rate: driven by frustration, abandonment, and the
  // prevalence of broken/silent interactions. Heuristic → explicit ±30% band.
  const brokenPrevalence = study.topFindings
    .filter((f) => f.category === "error-recovery" || /no visible response/i.test(f.title))
    .reduce((m, f) => Math.max(m, f.prevalence), 0);
  const perUser =
    0.3 * study.frustration.mean + 0.5 * study.dropoffRate + 0.2 * brokenPrevalence;
  const per100 = perUser * 100;
  predictions.push({
    metric: "Support contacts",
    estimate: round(per100, 1),
    low: round(per100 * 0.7, 1),
    high: round(per100 * 1.3, 1),
    unit: "per-100-users",
    basis: "modeled",
    note: "Modeled from frustration, abandonment, and broken-interaction prevalence (±30% band).",
  });

  // Predicted struggle points: friction screens (revisits / drop-offs).
  const maxRevisit = Math.max(
    1,
    ...study.navigationHeatmap.map((e) => (e.operators ? e.visits / e.operators : 0)),
  );
  const struggleForecasts: PredictedStruggle[] = study.navigationHeatmap
    .map((e) => {
      const revisit = e.operators ? e.visits / e.operators : 0;
      const dropShare = study.size ? e.dropoffs / study.size : 0;
      const predictedConfusion = round(clamp01(0.6 * dropShare + 0.4 * (revisit / maxRevisit)));
      const reasons: string[] = [];
      if (e.dropoffs) reasons.push(`${e.dropoffs} drop-off(s)`);
      if (revisit >= 3) reasons.push(`${round(revisit, 1)}× revisits/user`);
      return { screen: shortName(e.screen), predictedConfusion, reason: reasons.join(", ") || "high traffic" };
    })
    .filter((s) => s.predictedConfusion > 0)
    .sort((a, b) => b.predictedConfusion - a.predictedConfusion)
    .slice(0, 5);

  return {
    url: study.url,
    label: study.label ?? study.url,
    size: n,
    predictions,
    struggleForecasts,
    generatedAt: new Date().toISOString(),
  };
}
