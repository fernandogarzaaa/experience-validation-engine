import type { ApplicationMemory, SessionMemoryRecord } from "./longTerm.js";

/**
 * Cross-session learning analysis.
 *
 * Computes the metrics the mission calls for from an application's session
 * history: Learning Rate (power law of practice; Newell & Rosenbloom 1981),
 * Retention, Memory Recall, a Forgetting Curve, and Recognition-vs-Recall.
 * Also emits an inline SVG learning-curve chart for reports.
 */

export interface LearningMetrics {
  sessions: number;
  /** Power-law exponent α in T(n) = T(1)·n^(−α); higher = faster learning. */
  learningRate: number;
  /** R² of the power-law fit (how power-law-like the improvement is). */
  learningFit: number;
  /** Fraction of first-session task time the latest session takes (lower is better). */
  timeReductionRatio: number;
  /** Confidence trend: latest minus first session mean confidence. */
  confidenceTrend: number;
  /** Fraction of prior-known affordances still recallable now (0..1). */
  retention: number;
  /** Distinct screens the operator can recognize on sight. */
  recognizedScreens: number;
  /** Screens whose navigation path the operator can recall unaided. */
  recalledPaths: number;
  /**
   * Recognition-vs-recall ratio: recognition ≥ recall for humans (Nielsen
   * heuristic #6). > 1 means the UI leans on recognition (good).
   */
  recognitionRecallRatio: number;
  /** Per-session efficiency series (steps), first→latest. */
  stepsSeries: number[];
  /** Per-session duration series (ms), first→latest. */
  durationSeries: number[];
  /** Per-session confidence series. */
  confidenceSeries: number[];
}

/** Fit T(n) = a·n^(−α) by least squares on log-log; returns {alpha, r2, a}. */
function fitPowerLaw(values: number[]): { alpha: number; r2: number; a: number } {
  const points = values
    .map((v, i) => ({ x: Math.log(i + 1), y: Math.log(Math.max(1e-6, v)) }))
    .filter((p) => Number.isFinite(p.y));
  const n = points.length;
  if (n < 2) return { alpha: 0, r2: 0, a: values[0] ?? 0 };
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  const sxx = points.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = points.reduce((s, p) => s + p.x * p.y, 0);
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return { alpha: 0, r2: 0, a: values[0] ?? 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  // Predicted vs actual for R².
  const meanY = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const pred = intercept + slope * p.x;
    ssTot += (p.y - meanY) ** 2;
    ssRes += (p.y - pred) ** 2;
  }
  const r2 = ssTot < 1e-9 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { alpha: -slope, r2, a: Math.exp(intercept) };
}

export function computeLearningMetrics(memory: ApplicationMemory): LearningMetrics {
  const history = [...memory.history].sort((a, b) => a.session - b.session);
  const stepsSeries = history.map((h) => h.steps);
  const durationSeries = history.map((h) => h.durationMs);
  const confidenceSeries = history.map((h) => h.confidence);

  const timeFit = fitPowerLaw(durationSeries.length >= 2 ? durationSeries : stepsSeries);
  const first = history[0];
  const last = history[history.length - 1];

  const timeReductionRatio =
    first && last && first.durationMs > 0 ? last.durationMs / first.durationMs : 1;
  const confidenceTrend = first && last ? last.confidence - first.confidence : 0;

  // Recognition: screens with any retained affordance recall.
  let recognizedScreens = 0;
  let recalledPaths = 0;
  for (const screen of Object.values(memory.screens)) {
    const strengths = Object.values(screen.affordances);
    if (strengths.some((s) => s > 0.15)) recognizedScreens += 1;
    // A path is "recalled" if the operator both recognizes the screen and
    // has a strong (>0.5) memory of at least one affordance leading onward.
    if (strengths.some((s) => s > 0.5)) recalledPaths += 1;
  }
  const recognitionRecallRatio =
    recalledPaths > 0 ? recognizedScreens / recalledPaths : recognizedScreens > 0 ? 2 : 1;

  // Retention: mean affordance strength across all remembered screens.
  const allStrengths: number[] = [];
  for (const screen of Object.values(memory.screens)) {
    allStrengths.push(...Object.values(screen.affordances));
  }
  const retention =
    allStrengths.length > 0 ? allStrengths.reduce((a, b) => a + b, 0) / allStrengths.length : 0;

  return {
    sessions: history.length,
    learningRate: Number(timeFit.alpha.toFixed(3)),
    learningFit: Number(timeFit.r2.toFixed(3)),
    timeReductionRatio: Number(timeReductionRatio.toFixed(3)),
    confidenceTrend: Number(confidenceTrend.toFixed(3)),
    retention: Number(retention.toFixed(3)),
    recognizedScreens,
    recalledPaths,
    recognitionRecallRatio: Number(recognitionRecallRatio.toFixed(2)),
    stepsSeries,
    durationSeries,
    confidenceSeries,
  };
}

/**
 * Model an Ebbinghaus forgetting curve for a given retention trait, sampled
 * at N session gaps. Returns retention fraction 0..1 per elapsed session.
 */
export function forgettingCurve(
  retentionTrait: number,
  gaps = 10,
): Array<{ elapsed: number; retention: number }> {
  const lambda = 0.5 * (1 - retentionTrait * 0.8);
  const out: Array<{ elapsed: number; retention: number }> = [];
  for (let d = 0; d <= gaps; d++)
    out.push({ elapsed: d, retention: Number(Math.exp(-lambda * d).toFixed(4)) });
  return out;
}

/** Inline SVG line chart of a per-session series (for HTML reports). */
export function renderLearningCurveSvg(
  metrics: LearningMetrics,
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width ?? 640;
  const height = options.height ?? 220;
  const pad = 34;
  const series: Array<{ label: string; color: string; values: number[]; normalize: boolean }> = [
    { label: "steps", color: "#2970ff", values: metrics.stepsSeries, normalize: true },
    {
      label: "confidence",
      color: "#12b76a",
      values: metrics.confidenceSeries.map((c) => c),
      normalize: false,
    },
  ];
  if (metrics.sessions < 2) {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Learning curve"><text x="20" y="30" font-size="13" fill="#98a2b3">Not enough sessions yet — run EVE against the same app again to build a learning curve.</text></svg>`;
  }
  const n = metrics.sessions;
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);

  const lines = series
    .map((s) => {
      const max = s.normalize ? Math.max(1, ...s.values) : 1;
      const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
      const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
    })
    .join("\n  ");
  const axis = `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#e2e5ea"/>`;
  const labels = `<text x="${pad}" y="${height - 8}" font-size="10" fill="#98a2b3">session 1</text><text x="${width - pad - 46}" y="${height - 8}" font-size="10" fill="#98a2b3">session ${n}</text>`;
  const legend = `<text x="${pad}" y="16" font-size="11" fill="#2970ff">steps/session (lower=better)</text><text x="${pad + 180}" y="16" font-size="11" fill="#12b76a">confidence</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Learning curve">
  ${axis}
  ${lines}
  ${labels}
  ${legend}
</svg>`;
}

export type { SessionMemoryRecord };
