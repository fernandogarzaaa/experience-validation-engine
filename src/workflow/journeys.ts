import type { LoopIteration } from "../core/types.js";
import type { WorkflowKind } from "./catalog.js";
import type { WorkflowGraph, WorkflowNode } from "./graph.js";

/**
 * User-journey discovery.
 *
 * Where workflow detection classifies individual screens, journey discovery
 * recovers the *sequence* the operator actually performed to accomplish a
 * higher-order goal — "how do I become a paying customer?" — with no
 * predefined script. This is task analysis from observed behavior (Card,
 * Moran & Newell 1983, GOMS), reconstructed post-hoc from the interaction
 * trace.
 *
 * A discovered journey is the ordered list of screens visited plus the
 * actions that connected them, annotated with where friction occurred
 * (errors, dead clicks, backtracks, hesitation), and whether the journey
 * reached a terminal/confirmation state.
 */

export interface JourneyStep {
  readonly step: number;
  readonly url: string;
  readonly title: string;
  readonly workflowKind: WorkflowKind;
  readonly action: string;
  readonly rationale: string;
  /** Friction observed at this step. */
  readonly friction: readonly string[];
  readonly frustration: number;
}

export interface DiscoveredJourney {
  readonly goal: string;
  readonly steps: readonly JourneyStep[];
  readonly reachedTerminal: boolean;
  readonly abandoned: boolean;
  /** Screens (by title) that formed the critical path, deduplicated. */
  readonly path: readonly string[];
  /** Number of steps that were pure friction (no forward progress). */
  readonly wastedSteps: number;
  /** Total simulated time for the journey, ms. */
  readonly durationMs: number;
  /** Friction points ranked by severity, for reporting. */
  readonly frictionPoints: readonly { title: string; reasons: string[]; frustration: number }[];
}

const TERMINAL_KINDS: ReadonlySet<WorkflowKind> = new Set(["confirmation"]);

/**
 * Reconstruct the journey the operator took toward their goal from the
 * iteration trace and the discovered workflow graph.
 */
export function discoverJourney(
  goal: string,
  iterations: readonly LoopIteration[],
  graph: WorkflowGraph,
  outcome: { goalAchieved: boolean; abandoned: boolean },
): DiscoveredJourney {
  const nodeByUrl = new Map<string, WorkflowNode>();
  for (const node of graph.allNodes()) nodeByUrl.set(node.url, node);

  const steps: JourneyStep[] = [];
  let lastUrl: string | null = null;
  let wastedSteps = 0;

  for (const it of iterations) {
    const node = nodeByUrl.get(it.url);
    const friction: string[] = [];
    const o = it.outcome;
    if (o?.errorPerceived) friction.push("a visible error appeared");
    if (o?.prediction.expectsChange && !o.screenChanged)
      friction.push("the action produced no visible response");
    if (o && o.surprise > 0.6) friction.push("the result was surprising");
    if (it.action.kind === "back") friction.push("the operator backtracked");
    if (o && o.perceivedLatencyMs > 3000)
      friction.push(`a ${(o.perceivedLatencyMs / 1000).toFixed(1)}s wait`);

    const forwardProgress =
      it.url !== lastUrl &&
      it.action.kind !== "back" &&
      it.action.kind !== "read" &&
      it.action.kind !== "wait";
    if (!forwardProgress && (it.action.kind === "back" || friction.length > 0)) wastedSteps += 1;

    const frustration =
      typeof (it.emotion as Record<string, number>).frustration === "number"
        ? (it.emotion as Record<string, number>).frustration!
        : 0;

    steps.push({
      step: it.step,
      url: it.url,
      title: node?.title ?? it.url,
      workflowKind: node?.kind ?? "unknown",
      action: it.actionDescription,
      rationale: it.rationale,
      friction,
      frustration,
    });
    lastUrl = it.url;
  }

  // Critical path: distinct screen titles in visit order.
  const path: string[] = [];
  for (const s of steps) {
    if (path[path.length - 1] !== s.title) path.push(s.title);
  }

  const reachedTerminal =
    outcome.goalAchieved ||
    steps.some((s) => TERMINAL_KINDS.has(s.workflowKind)) ||
    graph.allNodes().some((n) => TERMINAL_KINDS.has(n.kind) && n.visits > 0);

  const frictionPoints = aggregateFriction(steps);
  const durationMs =
    steps.length > 0
      ? (iterations[iterations.length - 1]?.timestamp ?? 0) - (iterations[0]?.timestamp ?? 0)
      : 0;

  return {
    goal,
    steps,
    reachedTerminal,
    abandoned: outcome.abandoned,
    path,
    wastedSteps,
    durationMs: Math.max(0, durationMs),
    frictionPoints,
  };
}

function aggregateFriction(steps: readonly JourneyStep[]): DiscoveredJourney["frictionPoints"] {
  const byTitle = new Map<string, { reasons: Set<string>; frustration: number }>();
  for (const s of steps) {
    if (s.friction.length === 0) continue;
    const entry = byTitle.get(s.title) ?? { reasons: new Set(), frustration: 0 };
    for (const r of s.friction) entry.reasons.add(r);
    entry.frustration = Math.max(entry.frustration, s.frustration);
    byTitle.set(s.title, entry);
  }
  return [...byTitle.entries()]
    .map(([title, v]) => ({
      title,
      reasons: [...v.reasons],
      frustration: Number(v.frustration.toFixed(2)),
    }))
    .sort((a, b) => b.frustration - a.frustration || b.reasons.length - a.reasons.length);
}

/**
 * Infer a natural-language description of the journey the operator was on,
 * from the sequence of workflow kinds encountered. Used when no explicit
 * goal was given ("the operator appears to be signing up and paying").
 */
export function inferJourneyIntent(journey: DiscoveredJourney): string {
  const kinds = [
    ...new Set(journey.steps.map((s) => s.workflowKind).filter((k) => k !== "unknown")),
  ];
  if (kinds.length === 0) return "The operator explored without a recognizable journey.";
  const readable = kinds.map((k) => k.replace(/-/g, " "));
  const terminalNote = journey.reachedTerminal
    ? " and reached a completion state"
    : " but did not complete it";
  return `The operator moved through: ${readable.join(" → ")}${terminalNote}.`;
}
