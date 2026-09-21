/**
 * Human-readable rendering of a predictive-UX report.
 */

import type { UXPrediction } from "./predict.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Render UX predictions as Markdown. */
export function renderUXPredictionMarkdown(prediction: UXPrediction): string {
  const lines: string[] = [
    `# Predictive UX — ${prediction.label ?? prediction.url}`,
    "",
    `Simulation estimates from ${prediction.size} simulated operators (NOT a random sample of real users — no population inference is claimed). Generated ${prediction.generatedAt}.`,
    "",
    "## Simulation estimates (ranges are simulation-sample uncertainty, not real-user confidence intervals)",
    "",
    "| Metric | Estimate | Range | Basis | Status |",
    "|---|---|---|---|---|",
  ];
  for (const p of prediction.predictions) {
    const fmt = (v: number) => (p.unit === "proportion" ? pct(v) : `${v}`);
    const unit = p.unit === "per-100-users" ? " / 100 users" : "";
    lines.push(
      `| ${p.metric} | ${fmt(p.estimate)}${unit} | ${fmt(p.low)} – ${fmt(p.high)}${unit} | ${p.basis} | ${p.calibrationStatus} |`,
    );
  }

  lines.push("", "## Heuristic confusion-risk indices (NOT calibrated probabilities)");
  if (prediction.struggleForecasts.length === 0) {
    lines.push("- No screens flagged by the heuristic.");
  } else {
    for (const s of prediction.struggleForecasts) {
      lines.push(
        `- **${s.screen}** — confusion-risk index ${s.predictedConfusion.toFixed(2)} (${s.reason}).`,
      );
    }
  }

  lines.push("", "_Notes:_");
  for (const p of prediction.predictions) lines.push(`- **${p.metric}:** ${p.note}`);
  lines.push("");
  return lines.join("\n");
}
