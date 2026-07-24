/**
 * Human-readable rendering of a predictive-UX report.
 */

import type { UXPrediction } from "./predict.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Render UX predictions as Markdown. */
export function renderUXPredictionMarkdown(prediction: UXPrediction): string {
  const lines: string[] = [
    `# Predictive UX — ${prediction.url}`,
    "",
    `Extrapolated from ${prediction.size} simulated users. Generated ${prediction.generatedAt}.`,
    "",
    "## Predictions (95% confidence)",
    "",
    "| Metric | Estimate | Range | Basis |",
    "|---|---|---|---|",
  ];
  for (const p of prediction.predictions) {
    const fmt = (v: number) => (p.unit === "proportion" ? pct(v) : `${v}`);
    const unit = p.unit === "per-100-users" ? " / 100 users" : "";
    lines.push(
      `| ${p.metric} | ${fmt(p.estimate)}${unit} | ${fmt(p.low)} – ${fmt(p.high)}${unit} | ${p.basis} |`,
    );
  }

  lines.push("", "## Predicted struggle points");
  if (prediction.struggleForecasts.length === 0) {
    lines.push("- No screens are predicted to cause struggle.");
  } else {
    for (const s of prediction.struggleForecasts) {
      lines.push(`- **${s.screen}** — confusion risk ${pct(s.predictedConfusion)} (${s.reason}).`);
    }
  }

  lines.push("", "_Notes:_");
  for (const p of prediction.predictions) lines.push(`- **${p.metric}:** ${p.note}`);
  lines.push("");
  return lines.join("\n");
}
