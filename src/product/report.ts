/**
 * Human-readable rendering of inferred product intelligence.
 */

import type { ProductIntelligence } from "./intelligence.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Render product intelligence as a Markdown product report. */
export function renderProductIntelligenceMarkdown(intel: ProductIntelligence): string {
  const lines: string[] = [
    `# Product intelligence — ${intel.label ?? intel.url}`,
    "",
    `Inferred from the behaviour of ${intel.size} simulated users. Generated ${intel.generatedAt}.`,
    "",
    "## Inferred user personas",
  ];
  for (const p of intel.personas) {
    lines.push(
      `- **${p.archetype}** — ${pct(p.share)} of users (typically \`${p.typicalPersona}\`), ` +
        `${pct(p.successRate)} success. ${p.description}`,
    );
  }

  lines.push("", "## Business goals (by traffic)");
  if (intel.businessGoals.length === 0) {
    lines.push("- Could not classify screens into business goals.");
  } else {
    for (const g of intel.businessGoals) {
      lines.push(`- **${g.goal}** — ${pct(g.trafficShare)} of traffic. ${g.evidence}`);
    }
  }

  lines.push("", "## Critical workflows");
  if (intel.criticalWorkflows.length === 0) {
    lines.push("- No dominant workflow emerged.");
  } else {
    for (const w of intel.criticalWorkflows) {
      lines.push(`- **${w.label}:** ${w.sequence.join(" → ")} _(≥${w.traversals} traversals)_`);
    }
  }

  lines.push("", "## Feature importance");
  for (const f of intel.featureImportance) {
    lines.push(
      `- **${f.feature}** — importance ${f.importance}/100 (reach ${pct(f.reach)}, ${f.visits} visits)${f.onCriticalPath ? " · on the critical path" : ""}`,
    );
  }

  lines.push("", "## High-friction pages");
  if (intel.highFrictionPages.length === 0) {
    lines.push("- No high-friction pages detected.");
  } else {
    for (const p of intel.highFrictionPages) {
      lines.push(`- **${p.screen}** — friction ${p.frictionScore}/100. ${p.reasons.join("; ")}.`);
    }
  }

  lines.push("", "## Drop-off causes");
  if (intel.dropoffCauses.length === 0) {
    lines.push("- No abandonment observed.");
  } else {
    for (const d of intel.dropoffCauses) {
      lines.push(`- **${d.screen}** — ${d.operators} user(s) (${pct(d.share)}). ${d.likelyCause}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
