import type { Finding, Score } from "../core/types.js";
import type { SessionResult } from "../engine/session.js";

/**
 * Report assembly: derives the narrative pieces (executive summary,
 * recommendations, quick wins) from a session result. Renderers (markdown,
 * html, json) consume this structure.
 */

export interface ExperienceReport {
  readonly result: SessionResult;
  readonly generatedAt: string;
  readonly executiveSummary: string;
  readonly overallScore: number;
  readonly quickWins: readonly string[];
  readonly longTermImprovements: readonly string[];
}

export function buildReport(result: SessionResult): ExperienceReport {
  const overall = result.scores.find((s) => s.dimension === "overall")?.value ?? 0;
  return {
    result,
    generatedAt: new Date().toISOString(),
    executiveSummary: executiveSummary(result, overall),
    overallScore: overall,
    quickWins: quickWins(result.findings),
    longTermImprovements: longTermImprovements(result),
  };
}

function executiveSummary(result: SessionResult, overall: number): string {
  const critical = result.findings.filter((f) => f.severity === "critical").length;
  const major = result.findings.filter((f) => f.severity === "major").length;
  const grade =
    overall >= 85 ? "excellent" : overall >= 70 ? "good" : overall >= 55 ? "mixed" : overall >= 40 ? "poor" : "failing";
  const outcome = result.abandoned
    ? `The operator ultimately gave up: ${result.abandonReason ?? "frustration exceeded tolerance"}.`
    : result.goalAchieved
      ? "The operator achieved their goal."
      : "The operator ran out of time/steps without completing their goal.";
  const finalEmotion = result.emotionTimeline.at(-1)?.values;
  const emotionalNote = finalEmotion
    ? ` They ended the session with ${pct(finalEmotion.confidence)} confidence, ${pct(finalEmotion.frustration)} frustration and ${pct(finalEmotion.trust)} trust in the product.`
    : "";
  return (
    `A simulated "${result.personaName}" spent ${(result.usage.durationMs / 1000 / 60).toFixed(1)} simulated minutes ` +
    `(${result.usage.steps} interactions) with ${result.startUrl}. ${result.appTheory} ` +
    `The experience was ${grade} (overall score ${overall}/100), with ${critical} critical and ${major} major issue(s). ${outcome}${emotionalNote}`
  );
}

function quickWins(findings: readonly Finding[]): string[] {
  const wins: string[] = [];
  for (const f of findings) {
    if (f.severity === "critical") continue; // criticals are rarely "quick"
    if (
      f.category === "accessibility" ||
      f.category === "visual" ||
      f.title.startsWith("No visible response")
    ) {
      wins.push(f.recommendation ?? `${f.title} — ${f.description.split(".")[0]}.`);
    }
    if (wins.length >= 6) break;
  }
  if (wins.length === 0) wins.push("No obvious quick wins — remaining issues need deeper work.");
  return wins;
}

function longTermImprovements(result: SessionResult): string[] {
  const items: string[] = [];
  const scoreOf = (d: Score["dimension"]) => result.scores.find((s) => s.dimension === d)?.value ?? 100;

  if (scoreOf("learnability") < 60) {
    items.push(
      "Invest in learnability: the operator's mental model never converged — align labels, layouts and outcomes with common conventions so behavior becomes predictable.",
    );
  }
  if (scoreOf("navigation") < 60 || scoreOf("informationArchitecture") < 60) {
    items.push(
      "Rework the information architecture: the operator spent significant time hunting and backtracking. Card-sort the navigation and flatten deep or ambiguous paths.",
    );
  }
  if (scoreOf("errorRecovery") < 60) {
    items.push(
      "Design an error-recovery strategy: errors currently strand users. Every error state needs a plain-language explanation and one obvious way forward.",
    );
  }
  if (scoreOf("responsiveness") < 60) {
    items.push(
      "Set a performance budget: perceived latency repeatedly broke the operator's flow. Target <1s for interactions with immediate (<100ms) feedback.",
    );
  }
  if (scoreOf("workflowQuality") < 60) {
    items.push(
      "Audit core workflows end-to-end: discovered workflows could not be completed. Instrument funnels and remove dead ends.",
    );
  }
  if (scoreOf("trust") < 55) {
    items.push(
      "Rebuild trust signals: broken promises (errors, dead controls, surprises) eroded the operator's trust. Consistency and honest feedback are the fix, not visual polish.",
    );
  }
  if (items.length === 0) {
    items.push("Sustain quality with regression guardrails: add EVE runs to CI so experience quality is tracked like correctness.");
  }
  return items;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
