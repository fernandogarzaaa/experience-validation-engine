/**
 * Human-readable rendering of an AI-moderated user study.
 */

import type { ExecutiveStudyReport } from "./types.js";

const VERDICT_BADGE = {
  ship: "✅ SHIP",
  "ship-with-fixes": "⚠️ SHIP WITH FIXES",
  "do-not-ship": "⛔ DO NOT SHIP",
} as const;

/** Render the executive study report (with the specialist appendix) as Markdown. */
export function renderModeratedStudyMarkdown(report: ExecutiveStudyReport): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const lines: string[] = [
    "# AI-moderated user study — executive report",
    "",
    `## ${VERDICT_BADGE[report.verdict]}`,
    "",
    report.headline,
    "",
    `- **Task success:** ${pct(report.successRate)} · **Drop-off:** ${pct(report.dropoffRate)}`,
    `- **Panel confidence:** ${pct(report.confidence)}`,
    "",
    "## Consensus",
  ];

  if (report.consensus.length === 0) {
    lines.push("- The panel raised no shared themes.");
  } else {
    for (const c of report.consensus) {
      lines.push(`- **${c.theme}** _(${c.severity}; ${c.roles.length} specialists)_ — ${c.statement}`);
      lines.push(`  - Raised by: ${c.roles.join(", ")}`);
    }
  }

  lines.push("", "## Conflicts");
  if (report.conflicts.length === 0) {
    lines.push("- No conflicts — the panel's stances are compatible.");
  } else {
    for (const c of report.conflicts) {
      lines.push(`- **${c.topic}:** ${c.note}`);
      for (const p of c.positions) lines.push(`  - ${p.role}: ${p.stance}`);
    }
  }

  lines.push("", "## Prioritized recommendations");
  report.priorities.forEach((p, i) => {
    lines.push(`${i + 1}. **${p.action}** _(priority ${p.score}; ${p.sources.join(", ")})_`);
    lines.push(`   - ${p.rationale}`);
  });

  lines.push("", "## Specialist reports");
  for (const s of report.specialists) {
    lines.push("", `### ${s.role} — _${s.stance}_ (confidence ${pct(s.confidence)})`);
    lines.push(s.summary, "");
    for (const o of s.observations) lines.push(`- [${o.severity}] ${o.statement} — ${o.evidence}`);
    if (s.recommendations.length) {
      lines.push("", "Recommendations:");
      for (const r of s.recommendations) lines.push(`- (${r.priority}) ${r.action} — ${r.rationale}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
