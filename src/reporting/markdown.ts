import type { Finding } from "../core/types.js";
import type { ExperienceReport } from "./report.js";
import { pct } from "./report.js";

/** Render a full experience report as GitHub-flavored Markdown. */
export function renderMarkdown(report: ExperienceReport): string {
  const { result } = report;
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# Experience Report — ${result.startUrl}`);
  push();
  push(
    `> Persona: **${result.personaName}** · Seed: \`${result.seed}\` · Generated: ${report.generatedAt}`,
  );
  push();
  push("## Executive Summary");
  push();
  push(report.executiveSummary);
  push();

  push(`## Experience Score: ${report.overallScore}/100`);
  push();
  push("| Dimension | Score | Evidence |");
  push("|---|---:|---|");
  for (const score of result.scores) {
    push(
      `| ${labelOf(score.dimension)} | ${score.value} | ${score.evidence.join(" ").replaceAll("|", "\\|")} |`,
    );
  }
  push();

  const bySeverity = (sev: Finding["severity"]) =>
    result.findings.filter((f) => f.severity === sev);
  for (const [severity, heading] of [
    ["critical", "Critical Findings"],
    ["major", "Major UX Issues"],
    ["minor", "Minor UX Issues"],
  ] as const) {
    const findings = bySeverity(severity);
    push(`## ${heading} (${findings.length})`);
    push();
    if (findings.length === 0) push("_None._");
    for (const f of findings) {
      push(`### ${f.id} — ${f.title}`);
      push();
      push(`**Category:** ${f.category} · **Where:** ${f.url}`);
      push();
      push(f.description);
      if (f.evidence.length) {
        push();
        push("Evidence:");
        for (const e of f.evidence) push(`- ${e}`);
      }
      if (f.recommendation) {
        push();
        push(`**Recommendation:** ${f.recommendation}`);
      }
      push();
    }
  }

  push("## Workflow Analysis");
  push();
  if (result.workflows.length === 0) push("No recognizable workflows were discovered.");
  else {
    push("| Workflow | Screens | Completed | Errors |");
    push("|---|---:|:---:|---:|");
    for (const w of result.workflows) {
      push(`| ${w.kind} | ${w.screens.length} | ${w.completed ? "✅" : "❌"} | ${w.errorCount} |`);
    }
  }
  push();

  push("## Navigation Analysis");
  push();
  push(
    `- ${result.workflowNodes.length} distinct screens discovered; ${result.usage.uniqueUrls} unique locations.`,
  );
  push(`- ${result.workflowTransitions.length} navigation paths traversed.`);
  const backCount = result.iterations.filter((it) => it.action.kind === "back").length;
  push(`- The operator backtracked ${backCount} time(s).`);
  push();
  if (result.workflowTransitions.length > 0) {
    push("| From | To | Via | Times |");
    push("|---|---|---|---:|");
    for (const t of result.workflowTransitions.slice(0, 25)) {
      push(
        `| ${shortSig(t.from)} | ${shortSig(t.to)} | ${t.via.replaceAll("|", "\\|")} | ${t.count} |`,
      );
    }
    push();
  }

  push("## Expectation Violations");
  push();
  const violations = result.iterations.filter((it) => it.outcome && it.outcome.surprise > 0.5);
  if (violations.length === 0)
    push("_The application behaved as the operator expected throughout._");
  for (const it of violations.slice(0, 20)) {
    push(
      `- **Step ${it.step}** — ${it.actionDescription}: expected "${it.prediction.description}" but got ${it.outcome!.errorPerceived ? "an error" : it.outcome!.screenChanged ? "an unrelated screen" : "no response"} (surprise ${pct(it.outcome!.surprise)}).`,
    );
  }
  push();

  push("## Emotional Timeline");
  push();
  push("| Step | Confidence | Frustration | Confusion | Trust | Fatigue |");
  push("|---:|---:|---:|---:|---:|---:|");
  const samples = downsample(result.emotionTimeline, 20);
  for (const s of samples) {
    push(
      `| ${s.step} | ${pct(s.values.confidence)} | ${pct(s.values.frustration)} | ${pct(s.values.confusion)} | ${pct(s.values.trust)} | ${pct(s.values.fatigue)} |`,
    );
  }
  push();

  push("## Session Journal");
  push();
  for (const it of result.iterations) {
    const emo = it.emotion as Record<string, number>;
    push(
      `- **#${it.step}** \`${it.actionDescription}\` — _${it.rationale}_ (frustration ${pct(emo.frustration ?? 0)})`,
    );
  }
  push();

  // --- Phase-2 cognitive sections (only when the data is present) ---
  if (result.cognitiveLoad) {
    push("## Cognitive Load");
    push();
    push(
      `Mean Cognitive Load Index: **${result.cognitiveLoad.meanIndex}/100** · peak **${result.cognitiveLoad.peakIndex}/100**.`,
    );
    push();
    const worst = [...result.cognitiveLoad.samples].sort((a, b) => b.index - a.index)[0];
    if (worst) {
      const b = worst.breakdown;
      push(
        `Heaviest screen (step ${worst.step}): working memory ${pct(b.workingMemoryLoad)}, decisions ${pct(b.decisionLoad)}, reading ${pct(b.informationLoad)}, clutter ${pct(b.visualClutter)}, task-switch ${pct(b.taskSwitchLoad)}.`,
      );
    }
    push();
  }
  if (result.trustTimeline && result.trustTimeline.length > 0) {
    const last = result.trustTimeline[result.trustTimeline.length - 1]!;
    push("## Trust");
    push();
    push(`Final trust: **${pct(last.overall)}**.`);
    push();
    push("| Component | Final |");
    push("|---|---:|");
    for (const [k, v] of Object.entries(last.components)) {
      push(`| ${k.replace(/([A-Z])/g, " $1")} | ${pct(v as number)} |`);
    }
    push();
  }
  if (result.attention) {
    push("## Attention");
    push();
    push(
      `The operator made attention fixations across ${result.attention.fixations.length} glance(s). ` +
        `**${result.attention.missedChanges}** on-screen change(s) went unnoticed (change blindness).`,
    );
    push();
  }
  if (result.learningMetrics && result.learningMetrics.sessions > 1) {
    const lm = result.learningMetrics;
    push("## Cross-Session Learning");
    push();
    push(`Sessions on this app: **${lm.sessions}**.`);
    push(`- Learning rate (power-law α): **${lm.learningRate}** (fit R²=${lm.learningFit})`);
    push(`- Steps per session: ${lm.stepsSeries.join(" → ")}`);
    push(`- Task time is now **${Math.round(lm.timeReductionRatio * 100)}%** of the first session`);
    push(
      `- Confidence trend: ${lm.confidenceTrend >= 0 ? "+" : ""}${(lm.confidenceTrend * 100).toFixed(0)}%`,
    );
    push(
      `- Retention: **${pct(lm.retention)}** · recognized screens: ${lm.recognizedScreens} · recalled paths: ${lm.recalledPaths} (recognition:recall ${lm.recognitionRecallRatio})`,
    );
    push();
  }
  if (result.journey && result.journey.path.length > 0) {
    push("## Discovered Journey");
    push();
    push(`Goal: _${result.journey.goal}_`);
    push();
    push(`Path: ${result.journey.path.map((p) => `\`${p}\``).join(" → ")}`);
    push(`- Reached a completion state: ${result.journey.reachedTerminal ? "✅" : "❌"}`);
    push(`- Wasted steps (friction/backtracking): ${result.journey.wastedSteps}`);
    if (result.journey.frictionPoints.length > 0) {
      push();
      push("Friction points:");
      for (const fp of result.journey.frictionPoints.slice(0, 5)) {
        push(`- **${fp.title}** — ${fp.reasons.join("; ")} (frustration ${pct(fp.frustration)})`);
      }
    }
    push();
  }

  push("## Recommendations");
  push();
  push("### Quick Wins");
  push();
  for (const win of report.quickWins) push(`- ${win}`);
  push();
  push("### Long-Term Improvements");
  push();
  for (const item of report.longTermImprovements) push(`- ${item}`);
  push();
  push("---");
  push(
    "_Generated by [Experience Validation Engine](https://github.com/fernandogarzaaa/experience-validation-engine) — AI that experiences software like a human._",
  );

  return lines.join("\n");
}

function labelOf(dimension: string): string {
  return dimension
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function shortSig(signature: string): string {
  const path = signature.split("::")[0] ?? signature;
  return path.length > 42 ? `…${path.slice(-39)}` : path;
}

function downsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]!);
  return out;
}
