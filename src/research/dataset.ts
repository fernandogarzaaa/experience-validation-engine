/**
 * Research-mode exporters — turn a {@link PopulationStudy} into reproducible,
 * shareable research artifacts: a machine-readable JSON snapshot, an
 * operator-level CSV dataset for statistical tools, and a human-readable
 * Markdown report. These are the building blocks of "Research Mode".
 */

import type { OperatorRun, PopulationStudy } from "../population/population.js";
import type { Distribution } from "../population/stats.js";

export type DatasetFormat = "json" | "csv" | "markdown";

/** Full study as pretty-printed JSON. */
export function renderStudyJson(study: PopulationStudy): string {
  return JSON.stringify(study, null, 2);
}

const CSV_COLUMNS: readonly (keyof OperatorRun | "confidence" | "frustration" | "trust")[] = [
  "index",
  "persona",
  "profession",
  "culture",
  "seed",
  "overall",
  "completed",
  "goalAchieved",
  "abandoned",
  "endReason",
  "steps",
  "durationMinutes",
  "screensVisited",
  "findings",
  "criticalFindings",
  "confidence",
  "frustration",
  "trust",
  "segment",
];

/** Escape a value for CSV (quotes fields containing commas, quotes, newlines). */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * One row per operator — the tidy dataset a researcher loads into pandas/R.
 * Emotion columns are pulled out of the nested `emotions` object.
 */
export function renderOperatorCsv(study: PopulationStudy): string {
  const header = CSV_COLUMNS.join(",");
  const rows = study.operators.map((op) =>
    CSV_COLUMNS.map((col) => {
      if (col === "confidence" || col === "frustration" || col === "trust") {
        return csvCell(op.emotions[col]);
      }
      return csvCell(op[col]);
    }).join(","),
  );
  return [header, ...rows].join("\n");
}

/** Render a distribution as a one-line Markdown bullet. */
function dist(label: string, d: Distribution): string {
  return (
    `- **${label}:** mean ${d.mean}, sd ${d.stdDev}, ` +
    `median ${d.median} (p25 ${d.p25} – p75 ${d.p75}), range ${d.min}–${d.max}`
  );
}

/** A complete, human-readable study report. */
export function renderStudyMarkdown(study: PopulationStudy): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines: string[] = [
    `# EVE usability study — ${study.label ?? study.url}`,
    "",
    `Simulated **${study.size} operators**${study.goal ? ` attempting: _${study.goal}_` : " (open-ended exploration)"}. Generated ${study.generatedAt}.`,
    "",
    "## Headline",
    `- **Success rate:** ${pct(study.successRate)}`,
    `- **Drop-off rate:** ${pct(study.dropoffRate)}`,
    dist("Overall experience score", study.overallScore),
    dist("Confidence (end state)", study.confidence),
    dist("Frustration (end state)", study.frustration),
    dist("Trust (end state)", study.trust),
    "",
    "## Outcomes",
    ...Object.entries(study.endReasonBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `- ${reason}: ${n} (${pct(n / study.size)})`),
    "",
    "## Task-completion histogram (steps to complete)",
  ];

  if (study.completionHistogram.total === 0) {
    lines.push("- No operators completed the task.");
  } else {
    for (const bin of study.completionHistogram.bins) {
      const bar = "█".repeat(Math.max(0, Math.round(bin.share * 20)));
      lines.push(`- ${bin.label.padEnd(12)} ${bar} ${bin.count} (${pct(bin.share)})`);
    }
  }

  lines.push("", "## Expected user segments");
  for (const seg of study.segments) {
    lines.push(
      `- **${seg.name}** — ${seg.size} operators (${pct(seg.share)}), ` +
        `mean score ${seg.meanScore}, mean steps ${seg.meanSteps}. ${seg.description}`,
    );
  }

  lines.push("", "## Navigation heatmap (most-visited screens)");
  for (const entry of study.navigationHeatmap.slice(0, 12)) {
    lines.push(
      `- \`${entry.screen}\` — ${entry.visits} visits across ${entry.operators} operators (reach ${pct(entry.reach)})${entry.dropoffs ? `, ${entry.dropoffs} drop-off${entry.dropoffs > 1 ? "s" : ""} here` : ""}`,
    );
  }

  if (study.topFindings.length) {
    lines.push("", "## Most common findings (population-wide)");
    for (const f of study.topFindings) {
      lines.push(
        `- **[${f.severity}] ${f.title}** — hit by ${f.operatorsAffected} operators (${pct(f.prevalence)})${f.recommendation ? `. Fix: ${f.recommendation}` : ""}`,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

/** Render a study in the requested format. */
export function renderStudy(study: PopulationStudy, format: DatasetFormat): string {
  switch (format) {
    case "json":
      return renderStudyJson(study);
    case "csv":
      return renderOperatorCsv(study);
    case "markdown":
      return renderStudyMarkdown(study);
    default: {
      const exhaustive: never = format;
      throw new Error(`Unknown dataset format "${String(exhaustive)}"`);
    }
  }
}
