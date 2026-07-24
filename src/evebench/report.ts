/**
 * Human-readable rendering of an EVE Bench scorecard.
 */

import type { EveBenchReport } from "./evebench.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Render an EVE Bench report as a Markdown scorecard. */
export function renderEveBenchMarkdown(report: EveBenchReport): string {
  const lines: string[] = [
    "# EVE Bench — scorecard",
    "",
    `**Overall: ${report.overall}/100.** ${report.summary}`,
    `Generated ${report.generatedAt}.`,
    "",
    "| Case | Composite | Task success | Overall | Frustration | Trust | Cog. load | Expectation | Learnability |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const c of report.cases) {
    lines.push(
      `| ${c.id} | **${c.composite}** | ${pct(c.taskSuccess)} | ${c.overallScore} | ${c.frustration} | ` +
        `${c.trust} | ${c.cognitiveLoad} | ${pct(c.expectationAlignment)} | ${pct(c.learnability)} |`,
    );
  }
  lines.push(
    "",
    report.ordered
      ? "✅ Construct validity holds: composites rank excellent > average > bad."
      : "❌ Construct validity failed: the instrument did not rank the reference apps correctly.",
    "",
    "_Dimensions: task success & overall (higher = better); frustration & cognitive load (lower = better); trust, expectation alignment, learnability (higher = better)._",
    "",
  );
  return lines.join("\n");
}
