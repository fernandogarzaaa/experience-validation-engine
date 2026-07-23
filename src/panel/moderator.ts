import type { SessionResult } from "../engine/session.js";
import type { Finding, FindingSeverity } from "../core/types.js";
import type { DesignCritique } from "./designCritic.js";
import type { ExperienceForecast } from "../forecasting/forecast.js";

/**
 * Moderator AI.
 *
 * After a panel of personas has each used the product, the Moderator plays
 * the role of the research lead synthesizing a multi-participant study: it
 * compares every session, finds consensus (issues multiple personas hit),
 * surfaces disagreements (issues only one persona hit, or where personas
 * diverged), and produces a single executive report. Consensus across
 * independent evaluators is the strongest usability signal (Hertzum &
 * Jacobsen 2001, the evaluator effect: aggregating evaluators is what makes
 * discount usability reliable).
 */

export interface ConsensusIssue {
  readonly title: string;
  readonly category: string;
  readonly severity: FindingSeverity;
  /** Fraction of personas that encountered this issue, 0..1. */
  readonly agreement: number;
  readonly personas: readonly string[];
  readonly url: string;
  readonly representativeDescription: string;
}

export interface Disagreement {
  readonly topic: string;
  readonly detail: string;
}

export interface ExecutiveReport {
  readonly personaCount: number;
  readonly meanOverallScore: number;
  readonly scoreRange: { min: number; max: number };
  readonly completionRate: number;
  readonly abandonmentRate: number;
  readonly consensusIssues: readonly ConsensusIssue[];
  readonly disagreements: readonly Disagreement[];
  readonly perPersona: ReadonlyArray<{
    persona: string;
    overall: number;
    endReason: string;
    topFinding: string | null;
  }>;
  readonly executiveSummary: string;
  readonly topPriorities: readonly string[];
}

interface PanelInput {
  sessions: readonly SessionResult[];
  critique?: DesignCritique;
  forecast?: ExperienceForecast;
}

/**
 * Synthesize a panel of sessions into one executive report.
 */
export function moderatePanel(input: PanelInput): ExecutiveReport {
  const { sessions } = input;
  if (sessions.length === 0) {
    throw new Error("moderatePanel requires at least one session");
  }

  const scores = sessions.map((s) => s.scores.find((d) => d.dimension === "overall")?.value ?? 0);
  const meanOverallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const completionRate = sessions.filter((s) => s.goalAchieved).length / sessions.length;
  const abandonmentRate = sessions.filter((s) => s.abandoned).length / sessions.length;

  // Cluster findings across personas by a normalized key.
  const clusters = new Map<
    string,
    { finding: Finding; personas: Set<string>; descriptions: Set<string> }
  >();
  for (const session of sessions) {
    const perPersonaSeen = new Set<string>();
    for (const f of session.findings) {
      const key = normalizeFindingKey(f);
      if (perPersonaSeen.has(key)) continue;
      perPersonaSeen.add(key);
      const cluster = clusters.get(key) ?? { finding: f, personas: new Set(), descriptions: new Set() };
      cluster.personas.add(session.personaName);
      cluster.descriptions.add(f.description);
      // Keep the most severe representative.
      if (severityRank(f.severity) < severityRank(cluster.finding.severity)) cluster.finding = f;
      clusters.set(key, cluster);
    }
  }

  const personaCount = new Set(sessions.map((s) => s.personaName)).size;
  const consensusIssues: ConsensusIssue[] = [...clusters.values()]
    .map((c) => ({
      title: c.finding.title,
      category: c.finding.category,
      severity: c.finding.severity,
      agreement: Number((c.personas.size / personaCount).toFixed(2)),
      personas: [...c.personas],
      url: c.finding.url,
      representativeDescription: c.finding.description,
    }))
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) || b.agreement - a.agreement,
    );

  const consensus = consensusIssues.filter((i) => i.agreement >= 0.5 || personaCount === 1);
  const disagreements = findDisagreements(sessions, consensusIssues, personaCount);

  const perPersona = sessions.map((s) => ({
    persona: s.personaName,
    overall: s.scores.find((d) => d.dimension === "overall")?.value ?? 0,
    endReason: s.endReason,
    topFinding: s.findings[0]?.title ?? null,
  }));

  const topPriorities = buildPriorities(consensus, input.forecast, input.critique);
  const executiveSummary = buildExecutiveSummary({
    personaCount,
    meanOverallScore,
    completionRate,
    abandonmentRate,
    consensus,
    scores,
  });

  return {
    personaCount,
    meanOverallScore,
    scoreRange: { min: Math.min(...scores), max: Math.max(...scores) },
    completionRate: Number(completionRate.toFixed(2)),
    abandonmentRate: Number(abandonmentRate.toFixed(2)),
    consensusIssues: consensus,
    disagreements,
    perPersona,
    executiveSummary,
    topPriorities,
  };
}

function normalizeFindingKey(f: Finding): string {
  // Group similar findings: category + the stable head of the title (strip
  // the specific action/label suffix) + url.
  const head = f.title
    .toLowerCase()
    .replace(/["'].*$/, "")
    .replace(/[:—-].*$/, "")
    .replace(/\d+/g, "#")
    .trim();
  return `${f.category}:${head}:${f.url}`;
}

function findDisagreements(
  sessions: readonly SessionResult[],
  issues: readonly ConsensusIssue[],
  personaCount: number,
): Disagreement[] {
  const out: Disagreement[] = [];

  // Score spread: personas experienced the product very differently.
  const scores = sessions.map((s) => s.scores.find((d) => d.dimension === "overall")?.value ?? 0);
  const spread = Math.max(...scores) - Math.min(...scores);
  if (spread > 25) {
    const best = sessions[scores.indexOf(Math.max(...scores))]!;
    const worst = sessions[scores.indexOf(Math.min(...scores))]!;
    out.push({
      topic: "Experience varies sharply by user type",
      detail: `"${best.personaName}" scored ${Math.max(...scores)}/100 while "${worst.personaName}" scored ${Math.min(...scores)}/100 — the product serves some users far better than others.`,
    });
  }

  // Singleton issues: only one persona hit it (potential edge case or
  // persona-specific barrier).
  const singletons = issues.filter((i) => i.personas.length === 1 && personaCount > 2 && i.severity !== "minor");
  for (const s of singletons.slice(0, 3)) {
    out.push({
      topic: `Only "${s.personas[0]}" hit: ${s.title}`,
      detail: `${s.representativeDescription} Other personas did not encounter this — likely specific to this user type's path or expectations.`,
    });
  }

  // Completion disagreement.
  const completed = sessions.filter((s) => s.goalAchieved).map((s) => s.personaName);
  const failed = sessions.filter((s) => !s.goalAchieved).map((s) => s.personaName);
  if (completed.length > 0 && failed.length > 0) {
    out.push({
      topic: "Completion split across personas",
      detail: `Completed: ${completed.join(", ")}. Did not complete: ${failed.join(", ")}.`,
    });
  }

  return out;
}

function buildPriorities(
  consensus: readonly ConsensusIssue[],
  forecast: ExperienceForecast | undefined,
  critique: DesignCritique | undefined,
): string[] {
  const priorities: string[] = [];
  for (const issue of consensus.filter((i) => i.severity === "critical" || i.severity === "major").slice(0, 4)) {
    priorities.push(
      `Fix "${issue.title}" (${issue.severity}, ${Math.round(issue.agreement * 100)}% of personas) at ${issue.url}`,
    );
  }
  if (forecast) {
    for (const change of forecast.recommendedChanges.slice(0, 2)) {
      priorities.push(`${change.change} (est. +${Math.round(change.estimatedLift * 100)}% completion)`);
    }
  }
  if (critique) {
    for (const item of critique.items.filter((i) => i.severity !== "minor").slice(0, 2)) {
      priorities.push(`[design] ${item.title} — ${item.recommendation}`);
    }
  }
  return [...new Set(priorities)].slice(0, 8);
}

function buildExecutiveSummary(args: {
  personaCount: number;
  meanOverallScore: number;
  completionRate: number;
  abandonmentRate: number;
  consensus: readonly ConsensusIssue[];
  scores: number[];
}): string {
  const { personaCount, meanOverallScore, completionRate, abandonmentRate, consensus } = args;
  const grade =
    meanOverallScore >= 80 ? "strong" : meanOverallScore >= 65 ? "acceptable" : meanOverallScore >= 50 ? "weak" : "poor";
  const criticalConsensus = consensus.filter((i) => i.severity === "critical").length;
  const majorConsensus = consensus.filter((i) => i.severity === "major").length;
  return (
    `A panel of ${personaCount} distinct persona(s) evaluated the product. The overall experience is ${grade} ` +
    `(mean ${meanOverallScore}/100). ${Math.round(completionRate * 100)}% completed their goal; ` +
    `${Math.round(abandonmentRate * 100)}% abandoned. The panel reached consensus on ${consensus.length} issue(s), ` +
    `including ${criticalConsensus} critical and ${majorConsensus} major problem(s) that multiple user types independently hit — ` +
    `these are the highest-confidence targets for improvement.`
  );
}

function severityRank(severity: FindingSeverity): number {
  return { critical: 0, major: 1, minor: 2, info: 3 }[severity];
}
