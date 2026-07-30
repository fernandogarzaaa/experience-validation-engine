/**
 * Human-readable rendering of a calibration report.
 */

import type { CalibrationReport } from "./types.js";

const pct = (v: number | null): string => (v === null ? "n/a" : `${Math.round(v * 100)}%`);

/** Render a calibration report as Markdown. */
export function renderCalibrationMarkdown(report: CalibrationReport): string {
  const lines: string[] = [
    "# Human validation — calibration report",
    "",
    `${report.task ? `Task: _${report.task}_. ` : ""}EVE (n=${report.eveSampleSize}) vs humans (n=${report.humanSampleSize}). Generated ${report.generatedAt}.`,
    "",
    `## Similarity score: ${report.similarityScore}/100`,
    "",
    "| Dimension | Score |",
    "|---|---|",
    `| Behavior similarity (completion/abandonment) | ${pct(report.behaviorSimilarity)} |`,
    `| Navigation similarity (path overlap) | ${pct(report.navigationSimilarity)} |`,
    `| Timing similarity (effort) | ${pct(report.timingSimilarity)} |`,
    `| Friction-location correlation | ${report.frictionCorrelation === null ? "n/a" : report.frictionCorrelation} |`,
    `| Frustration alignment | ${pct(report.frustrationAlignment)} |`,
    `| Confidence alignment | ${pct(report.confidenceAlignment)} |`,
  ];
  if (report.notes.length) {
    lines.push("", "_Notes:_");
    for (const n of report.notes) lines.push(`- ${n}`);
  }
  lines.push(
    "",
    "_Lower dimensions point to where EVE and real humans diverge — the next place to tune the model._",
    "",
  );
  return lines.join("\n");
}
