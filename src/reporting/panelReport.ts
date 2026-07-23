import type { PanelResult } from "../panel/index.js";
import { toMarkdownTasks } from "../panel/developer.js";

/**
 * Render the AI panel's output (design critique, forecast, moderator
 * consensus, product plan, developer tickets) as a single executive Markdown
 * document.
 */
export function renderPanelMarkdown(panel: PanelResult): string {
  const { executive, critique, forecast, plan, tickets } = panel;
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# EVE Panel — Executive Experience Report`);
  push();
  push(`> Generated ${new Date().toISOString()} · ${executive.personaCount} persona(s)`);
  push();

  push(`## Executive Summary`);
  push();
  push(executive.executiveSummary);
  push();
  push(
    `- Mean experience score: **${executive.meanOverallScore}/100** (range ${executive.scoreRange.min}–${executive.scoreRange.max})`,
  );
  push(`- Completion rate: **${Math.round(executive.completionRate * 100)}%** · Abandonment: **${Math.round(executive.abandonmentRate * 100)}%**`);
  push();

  push(`## Top Priorities`);
  push();
  if (executive.topPriorities.length === 0) push(`_No high-priority issues — the experience is solid across personas._`);
  for (const p of executive.topPriorities) push(`1. ${p}`);
  push();

  push(`## Consensus Issues (multiple personas agreed)`);
  push();
  if (executive.consensusIssues.length === 0) push(`_No consensus issues._`);
  else {
    push(`| Issue | Severity | Agreement | Personas |`);
    push(`|---|---|---:|---|`);
    for (const i of executive.consensusIssues.slice(0, 15)) {
      push(`| ${i.title.replaceAll("|", "\\|")} | ${i.severity} | ${Math.round(i.agreement * 100)}% | ${i.personas.join(", ")} |`);
    }
  }
  push();

  if (executive.disagreements.length > 0) {
    push(`## Disagreements Between Personas`);
    push();
    for (const d of executive.disagreements) push(`- **${d.topic}** — ${d.detail}`);
    push();
  }

  push(`## Design Critic (independent heuristic inspection)`);
  push();
  push(`Inspection score: **${critique.inspectionScore}/100**. ${critique.summary}`);
  push();
  for (const item of critique.items.slice(0, 12)) {
    push(`- **[${item.severity}] ${item.title}** (${item.heuristic}) — ${item.detail} _→ ${item.recommendation}_`);
  }
  push();

  push(`## Experience Forecast`);
  push();
  push(forecast.summary);
  push();
  if (forecast.struggles.length > 0) {
    push(`**Predicted struggle points:**`);
    for (const s of forecast.struggles.slice(0, 6)) {
      push(`- ${s.location} — ${Math.round(s.struggleProbability * 100)}% risk (${s.signals.join(", ")})`);
    }
    push();
  }
  if (forecast.recommendedChanges.length > 0) {
    push(`**Highest-leverage changes:**`);
    for (const c of forecast.recommendedChanges) {
      push(`- ${c.change} — est. +${Math.round(c.estimatedLift * 100)}% completion. ${c.rationale}`);
    }
    push();
  }

  push(`## Product Plan`);
  push();
  push(`North star: _${plan.northStar}_`);
  push();
  push(plan.summary);
  push();
  for (const phase of plan.roadmap) {
    push(`### Roadmap — ${phase.phase}`);
    push(`_${phase.focus}_`);
    push();
    for (const epicId of phase.epics) {
      const epic = plan.epics.find((e) => e.id === epicId);
      if (!epic) continue;
      push(`- **${epic.id} · ${epic.title}** (priority ${epic.priorityScore}, +${Math.round(epic.estimatedCompletionLift * 100)}% est.) — ${epic.businessImpact}`);
    }
    push();
  }

  push(`## Developer Backlog`);
  push();
  push(`${tickets.length} ticket(s) generated. Full task document:`);
  push();
  push(toMarkdownTasks(tickets).split("\n").slice(1).join("\n"));

  return lines.join("\n");
}
