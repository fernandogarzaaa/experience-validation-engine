import type { ExecutiveReport } from "./moderator.js";
import type { ExperienceForecast } from "../forecasting/forecast.js";
import type { DesignCritique } from "./designCritic.js";
import type { FindingSeverity } from "../core/types.js";

/**
 * Product Manager AI.
 *
 * Translates the moderator's synthesis, the forecast and the design critique
 * into product artifacts: a prioritized backlog of epics and user stories
 * with business-impact estimates and a phased roadmap. Prioritization uses a
 * transparent value/effort model (a RICE-style heuristic: reach × impact ×
 * confidence ÷ effort) so the ordering is inspectable, not arbitrary.
 */

export interface UserStory {
  readonly id: string;
  readonly title: string;
  readonly asA: string;
  readonly iWant: string;
  readonly soThat: string;
  readonly acceptanceCriteria: readonly string[];
  readonly severity: FindingSeverity;
}

export interface Epic {
  readonly id: string;
  readonly title: string;
  readonly problem: string;
  readonly businessImpact: string;
  /** RICE-style priority score; higher = do sooner. */
  readonly priorityScore: number;
  readonly estimatedCompletionLift: number;
  readonly stories: readonly UserStory[];
}

export interface RoadmapPhase {
  readonly phase: string;
  readonly focus: string;
  readonly epics: readonly string[];
}

export interface ProductPlan {
  readonly epics: readonly Epic[];
  readonly roadmap: readonly RoadmapPhase[];
  readonly northStar: string;
  readonly summary: string;
}

interface PMInput {
  executive: ExecutiveReport;
  forecast?: ExperienceForecast;
  critique?: DesignCritique;
}

export function buildProductPlan(input: PMInput): ProductPlan {
  const { executive, forecast, critique } = input;
  const epics: Epic[] = [];
  let epicSeq = 0;
  let storySeq = 0;

  const nextEpic = () => `EPIC-${String(++epicSeq).padStart(2, "0")}`;
  const nextStory = () => `US-${String(++storySeq).padStart(3, "0")}`;

  // One epic per consensus issue cluster, prioritized by RICE.
  for (const issue of executive.consensusIssues) {
    const reach = issue.agreement; // fraction of personas = proxy for user reach
    const impact = impactWeight(issue.severity);
    const confidence = issue.agreement >= 0.5 ? 0.9 : 0.6;
    const effort = effortWeight(issue.category);
    const priorityScore = Number(((reach * impact * confidence) / effort).toFixed(2));
    const lift = forecast?.recommendedChanges.find((c) => c.change.toLowerCase().includes(issue.category))?.estimatedLift ?? impact * 0.1;

    epics.push({
      id: nextEpic(),
      title: `Resolve: ${issue.title}`,
      problem: issue.representativeDescription,
      businessImpact: businessImpact(issue.severity, issue.agreement, lift),
      priorityScore,
      estimatedCompletionLift: Number(lift.toFixed(2)),
      stories: [
        {
          id: nextStory(),
          title: issue.title,
          asA: issue.personas[0] ?? "user",
          iWant: `to ${storyGoal(issue.category)}`,
          soThat: "I can complete my task without confusion or friction",
          acceptanceCriteria: acceptanceFor(issue.category, issue.url),
          severity: issue.severity,
        },
      ],
    });
  }

  // Forecast-driven improvement epics (opportunities, not just defects).
  if (forecast) {
    for (const change of forecast.recommendedChanges.slice(0, 3)) {
      epics.push({
        id: nextEpic(),
        title: change.change.length > 70 ? change.change.slice(0, 67) + "…" : change.change,
        problem: change.rationale,
        businessImpact: `Estimated +${Math.round(change.estimatedLift * 100)}% task completion if addressed.`,
        priorityScore: Number((change.estimatedLift * 5).toFixed(2)),
        estimatedCompletionLift: change.estimatedLift,
        stories: [
          {
            id: nextStory(),
            title: change.change,
            asA: "user",
            iWant: "the interface to guide me clearly through this step",
            soThat: "I don't hesitate, doubt, or drop off",
            acceptanceCriteria: [
              "The step provides immediate, visible feedback to every action",
              "No dead ends: every state has a clear next action",
              "A simulated EVE re-run shows measurably lower struggle probability here",
            ],
            severity: "major",
          },
        ],
      });
    }
  }

  // Design-critique epics for structural issues.
  if (critique) {
    const structural = critique.items.filter((i) => i.severity === "major");
    if (structural.length > 0) {
      epics.push({
        id: nextEpic(),
        title: "Address expert design-review findings",
        problem: `Heuristic inspection flagged ${structural.length} structural issue(s) (${[...new Set(structural.map((s) => s.heuristic))].join(", ")}).`,
        businessImpact: "Reduces baseline friction for all users before they hit any specific task.",
        priorityScore: 1.5,
        estimatedCompletionLift: 0.08,
        stories: structural.slice(0, 5).map((item) => ({
          id: nextStory(),
          title: item.title,
          asA: "user",
          iWant: item.recommendation.replace(/^[A-Z]/, (c) => c.toLowerCase()),
          soThat: "the interface feels coherent and trustworthy",
          acceptanceCriteria: [item.recommendation, "Verified on the affected screen(s)"],
          severity: item.severity,
        })),
      });
    }
  }

  epics.sort((a, b) => b.priorityScore - a.priorityScore);
  const roadmap = buildRoadmap(epics);
  const northStar = `Raise mean cross-persona experience score from ${executive.meanOverallScore}/100 and lift completion from ${Math.round(executive.completionRate * 100)}%.`;

  return {
    epics,
    roadmap,
    northStar,
    summary: `${epics.length} epic(s) generated from ${executive.consensusIssues.length} consensus issue(s)${forecast ? " and forecast opportunities" : ""}, prioritized by reach × impact × confidence ÷ effort.`,
  };
}

function buildRoadmap(epics: readonly Epic[]): RoadmapPhase[] {
  const now = epics.filter((e) => e.priorityScore >= 0.6).map((e) => e.id);
  const next = epics.filter((e) => e.priorityScore >= 0.25 && e.priorityScore < 0.6).map((e) => e.id);
  const later = epics.filter((e) => e.priorityScore < 0.25).map((e) => e.id);
  const phases: RoadmapPhase[] = [];
  if (now.length) phases.push({ phase: "Now", focus: "Highest-confidence, highest-impact fixes multiple user types hit", epics: now });
  if (next.length) phases.push({ phase: "Next", focus: "Meaningful friction affecting some personas or forecast risk", epics: next });
  if (later.length) phases.push({ phase: "Later", focus: "Polish and lower-confidence opportunities", epics: later });
  return phases;
}

function impactWeight(severity: FindingSeverity): number {
  return { critical: 1, major: 0.6, minor: 0.25, info: 0.1 }[severity];
}

function effortWeight(category: string): number {
  // Rough effort proxy: content/microcopy is cheap; navigation/IA is costly.
  if (category === "content" || category === "visual") return 0.5;
  if (category === "navigation" || category === "workflow") return 1.5;
  if (category === "accessibility") return 0.8;
  return 1;
}

function businessImpact(severity: FindingSeverity, agreement: number, lift: number): string {
  const audience = agreement >= 0.75 ? "most users" : agreement >= 0.5 ? "many users" : "a segment of users";
  const consequence =
    severity === "critical"
      ? "directly causes task abandonment"
      : severity === "major"
        ? "significantly slows completion and erodes trust"
        : "adds friction and polish debt";
  return `Affects ${audience}; ${consequence}. Estimated completion lift +${Math.round(lift * 100)}%.`;
}

function storyGoal(category: string): string {
  switch (category) {
    case "navigation":
      return "find where to go without backtracking";
    case "error-recovery":
      return "understand what went wrong and how to fix it";
    case "usability":
      return "get a clear response to every action I take";
    case "accessibility":
      return "operate the interface regardless of my abilities";
    case "performance":
      return "not be left waiting after I act";
    default:
      return "complete my task smoothly";
  }
}

function acceptanceFor(category: string, url: string): string[] {
  const base = [`Verified on ${url}`, "A simulated EVE re-run no longer reports this finding"];
  switch (category) {
    case "usability":
      return ["Every interactive control produces visible feedback within 100ms", ...base];
    case "navigation":
      return ["A clear path to the target exists without backtracking", ...base];
    case "error-recovery":
      return ["Errors state the cause in plain language and offer one obvious recovery action", ...base];
    case "accessibility":
      return ["Meets WCAG 2.1 AA for the affected component", ...base];
    default:
      return base;
  }
}
