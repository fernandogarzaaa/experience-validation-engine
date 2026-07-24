/**
 * Human-readable rendering of a multimodal perception report.
 */

import type { MultimodalReport } from "./types.js";

/** Render a multimodal report as Markdown. */
export function renderMultimodalMarkdown(report: MultimodalReport): string {
  const lines: string[] = [
    "# Multimodal perception report",
    "",
    `Perceptor: \`${report.perceptor}\` · ${report.screensAnalyzed} screens · ` +
      `${report.totalCues} cues. Generated ${report.generatedAt}.`,
    "",
    "## Cues by kind",
    "",
    "| Kind | Count |",
    "|---|---|",
  ];
  for (const [kind, count] of Object.entries(report.byKind)) {
    lines.push(`| ${kind} | ${count} |`);
  }

  lines.push("", "## Dynamic UI");
  lines.push(`- **Screens with a loading state:** ${report.screensWithLoading}`);
  lines.push(`- **Toasts / notifications observed:** ${report.toasts.length}`);
  for (const t of report.toasts.slice(0, 8)) lines.push(`  - "${t.label}" on \`${t.screen}\``);

  lines.push("", "## Perception risks (unlabeled visuals)");
  if (report.unlabeled.length === 0) {
    lines.push("- None — every icon, chart, and image carries a readable label.");
  } else {
    const grouped = new Map<string, number>();
    for (const u of report.unlabeled) grouped.set(u.kind, (grouped.get(u.kind) ?? 0) + 1);
    for (const [kind, count] of grouped) {
      lines.push(`- ${count} unlabeled **${kind}** element(s) — invisible to screen readers and ambiguous to humans.`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
