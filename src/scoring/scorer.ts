import { findingCategoryRegistry } from "../core/findingCategories.js";
import { clamp } from "../core/random.js";
import type { Modality } from "../core/registry.js";
import type { Finding, LoopIteration, Score, ScoreDimension, SessionUsage } from "../core/types.js";
import type { EmotionSample } from "../emotion/emotionalState.js";
import type { DiscoveredWorkflow, WorkflowNode } from "../workflow/graph.js";
import { dimensionRegistry } from "./dimensions.js";

/**
 * Scoring: converts the raw record of an experience session into 0..100
 * scores per dimension, each carrying explicit evidence.
 *
 * Philosophy: scores are *derived measurements*, never vibes. Every deduction
 * traces back to something that happened — an expectation violation, a
 * finding, an emotion excursion, wasted steps — and that trace ships with the
 * score as its evidence list.
 *
 * Phase 2 (registry-driven, modality-gated):
 * - The sixteen built-in dimensions are still computed by name, unchanged —
 *   but only when the session's modality is one the dimension `appliesTo`
 *   (registered in `dimensionRegistry`). A visual-only dimension on a
 *   textual session is *skipped, not vacuously passed*.
 * - Dimensions registered by domain packs (e.g. `mcp.*`) are scored by the
 *   generic rule {@link scoreFromFindings} — the single home of the
 *   severity penalty schedule — from findings in categories linked via
 *   `FindingCategoryEntry.scoresInto`, and only when such findings exist
 *   (evidence-gated: no evidence, no dimension).
 */

/** The one severity penalty schedule: critical 25 / major 12 / minor 4 / info 1. */
export const FINDING_SEVERITY_PENALTY = {
  critical: 25,
  major: 12,
  minor: 4,
  info: 1,
} as const;

/** The slice of a finding the generic dimension rule needs. */
export type FindingEvidence = Pick<Finding, "severity" | "title">;

/**
 * The generic registered-dimension rule: 100 minus severity penalties, with
 * the driving findings cited. This is the *only* implementation of that
 * rule — the MCP harness retired its parallel copy in Phase 2.
 */
export function scoreFromFindings(
  dimension: Score["dimension"],
  findings: readonly FindingEvidence[],
): Score {
  let value = 100;
  const evidence: string[] = [];
  for (const f of findings) {
    value -= FINDING_SEVERITY_PENALTY[f.severity];
    if (evidence.length < 8) evidence.push(`[${f.severity}] ${f.title}`);
  }
  if (findings.length > evidence.length) {
    evidence.push(`…and ${findings.length - evidence.length} more finding(s).`);
  }
  if (evidence.length === 0) evidence.push("No findings on this dimension.");
  return { dimension, value: clamp(Math.round(value), 0, 100), evidence };
}

export interface ScoringInput {
  readonly iterations: readonly LoopIteration[];
  readonly findings: readonly Finding[];
  readonly emotionTimeline: readonly EmotionSample[];
  readonly workflows: readonly DiscoveredWorkflow[];
  readonly workflowNodes: readonly WorkflowNode[];
  readonly revisitRatio: number;
  readonly usage: SessionUsage;
  readonly goalAchieved: boolean;
  readonly abandoned: boolean;
  /**
   * The session's perceptual modality. When provided, dimensions whose
   * registry `appliesTo` excludes it are skipped, and applicable registered
   * dimensions with evidence are scored. Omit for phase-1 behavior (every
   * built-in computed, no registered extras) — used by tests that score
   * dimension math in isolation.
   */
  readonly modality?: Modality;
}

interface DimensionResult {
  value: number;
  evidence: string[];
}

export function computeScores(input: ScoringInput): Score[] {
  const results = new Map<string, DimensionResult>();

  // Modality gating (Phase 0 `appliesTo` metadata, wired in Phase 2): a
  // dimension the registry marks inapplicable to this session's modality is
  // skipped, not failed. Unknown ids (never happens for built-ins) apply.
  const applies = (id: string): boolean => {
    if (!input.modality) return true;
    const entry = dimensionRegistry.get(id);
    return !entry || entry.appliesTo.includes(input.modality);
  };
  const setScore = (id: ScoreDimension, r: DimensionResult): void => {
    if (applies(id)) results.set(id, r);
  };

  const outcomes = input.iterations
    .map((it) => it.outcome)
    .filter((o): o is NonNullable<typeof o> => o !== null);
  const surprises = outcomes.filter((o) => o.surprise > 0.5);
  const errors = outcomes.filter((o) => o.errorPerceived);
  const deadClicks = outcomes.filter((o) => o.prediction.expectsChange && !o.screenChanged);
  const surpriseRate = outcomes.length ? surprises.length / outcomes.length : 0;
  const errorRate = outcomes.length ? errors.length / outcomes.length : 0;

  const meanEmotion = (key: keyof EmotionSample["values"]): number => {
    if (input.emotionTimeline.length === 0) return 0.5;
    let sum = 0;
    for (const s of input.emotionTimeline) sum += s.values[key];
    return sum / input.emotionTimeline.length;
  };
  const peakEmotion = (key: keyof EmotionSample["values"]): number => {
    let max = 0;
    for (const s of input.emotionTimeline) max = Math.max(max, s.values[key]);
    return max;
  };

  const bySeverity = (severity: Finding["severity"]) =>
    input.findings.filter((f) => f.severity === severity);
  const byCategory = (category: Finding["category"]) =>
    input.findings.filter((f) => f.category === category);

  const findingPenalty = (
    findings: readonly Finding[],
    perCritical = 25,
    perMajor = 12,
    perMinor = 4,
  ): number => {
    let penalty = 0;
    for (const f of findings) {
      penalty +=
        f.severity === "critical"
          ? perCritical
          : f.severity === "major"
            ? perMajor
            : f.severity === "minor"
              ? perMinor
              : 1;
    }
    return penalty;
  };

  /* ---- usability -------------------------------------------------- */
  {
    const evidence: string[] = [];
    let value = 90;
    value -= surpriseRate * 45;
    if (surprises.length)
      evidence.push(
        `${surprises.length}/${outcomes.length} actions violated the operator's expectation.`,
      );
    value -= deadClicks.length * 6;
    if (deadClicks.length)
      evidence.push(
        `${deadClicks.length} interactions produced no visible response ("dead clicks").`,
      );
    value -= findingPenalty(byCategory("usability"));
    if (input.abandoned) {
      value -= 20;
      evidence.push("The operator abandoned the session before completing their goal.");
    }
    if (evidence.length === 0) evidence.push("Interactions consistently matched expectations.");
    setScore("usability", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- learnability ----------------------------------------------- */
  {
    const evidence: string[] = [];
    // Compare surprise rate in the first vs second half: did the operator's
    // mental model converge?
    const half = Math.floor(outcomes.length / 2);
    const early = outcomes.slice(0, half);
    const late = outcomes.slice(half);
    const rate = (xs: typeof outcomes) =>
      xs.length ? xs.filter((o) => o.surprise > 0.5).length / xs.length : 0;
    const improvement = rate(early) - rate(late);
    const value = 70 + improvement * 60 - peakEmotion("confusion") * 25;
    if (outcomes.length >= 6) {
      evidence.push(
        `Expectation-violation rate went from ${(rate(early) * 100).toFixed(0)}% (first half) to ${(rate(late) * 100).toFixed(0)}% (second half).`,
      );
    }
    evidence.push(`Peak confusion reached ${(peakEmotion("confusion") * 100).toFixed(0)}%.`);
    setScore("learnability", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- accessibility ---------------------------------------------- */
  {
    const findings = byCategory("accessibility");
    const evidence = findings.slice(0, 5).map((f) => f.title);
    const value = 95 - findingPenalty(findings, 30, 15, 5);
    if (evidence.length === 0)
      evidence.push("No accessibility barriers were perceived during the session.");
    setScore("accessibility", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- efficiency -------------------------------------------------- */
  {
    const evidence: string[] = [];
    const productiveSteps = input.iterations.filter(
      (it) => it.action.kind !== "wait" && it.action.kind !== "read",
    ).length;
    const wastedRatio = input.revisitRatio;
    let value = 88 - wastedRatio * 45 - deadClicks.length * 5;
    if (input.goalAchieved && productiveSteps > 0) {
      evidence.push(`Goal achieved in ${productiveSteps} productive steps.`);
      value += 8;
    }
    if (wastedRatio > 0.2)
      evidence.push(
        `${(wastedRatio * 100).toFixed(0)}% of screens were revisited repeatedly — the operator wandered.`,
      );
    evidence.push(
      `Session lasted ${(input.usage.durationMs / 1000).toFixed(1)}s over ${input.usage.steps} steps.`,
    );
    setScore("efficiency", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- consistency ------------------------------------------------- */
  {
    const findings = byCategory("consistency");
    const evidence = findings.slice(0, 5).map((f) => f.title);
    const value = 90 - findingPenalty(findings);
    // Surprise concentrated on repeat visits implies inconsistent behavior.
    if (evidence.length === 0)
      evidence.push("No behavioral or visual inconsistencies were perceived.");
    setScore("consistency", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- visual design ----------------------------------------------- */
  {
    const findings = byCategory("visual");
    const evidence = findings.slice(0, 6).map((f) => f.title);
    const value = 92 - findingPenalty(findings, 28, 12, 4);
    if (evidence.length === 0)
      evidence.push(
        "No visual defects (contrast, clipping, overflow, misalignment) were perceived.",
      );
    setScore("visualDesign", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- navigation --------------------------------------------------- */
  {
    const evidence: string[] = [];
    const backSteps = input.iterations.filter((it) => it.action.kind === "back").length;
    const value =
      88 - input.revisitRatio * 40 - backSteps * 4 - findingPenalty(byCategory("navigation"));
    if (backSteps > 0) evidence.push(`The operator backtracked ${backSteps} time(s).`);
    evidence.push(
      `${input.usage.uniqueUrls} distinct locations reached across ${input.usage.screensVisited} screens.`,
    );
    setScore("navigation", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- workflow quality --------------------------------------------- */
  {
    const evidence: string[] = [];
    const discovered = input.workflows;
    const completed = discovered.filter((w) => w.completed);
    let value = 70;
    if (discovered.length > 0) {
      value = 55 + (completed.length / discovered.length) * 35;
      evidence.push(
        `Discovered ${discovered.length} workflow(s): ${discovered.map((w) => w.kind).join(", ")}.`,
      );
      if (completed.length)
        evidence.push(`Completed end-to-end: ${completed.map((w) => w.kind).join(", ")}.`);
      const withErrors = discovered.filter((w) => w.errorCount > 0);
      if (withErrors.length) {
        value -= withErrors.length * 8;
        evidence.push(`Errors were perceived inside: ${withErrors.map((w) => w.kind).join(", ")}.`);
      }
    } else {
      evidence.push("No recognizable workflows were discovered.");
      value = 45;
    }
    setScore("workflowQuality", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- information architecture -------------------------------------- */
  {
    const evidence: string[] = [];
    // How often did goal-relevant elements exist where the operator looked?
    const searchy = input.iterations.filter(
      (it) => it.action.kind === "scroll" || it.action.kind === "back",
    ).length;
    const ratio = input.iterations.length ? searchy / input.iterations.length : 0;
    const value = 85 - ratio * 60 - findingPenalty(byCategory("content"));
    evidence.push(
      `${(ratio * 100).toFixed(0)}% of steps were spent hunting (scrolling/backtracking) rather than acting.`,
    );
    setScore("informationArchitecture", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- onboarding ----------------------------------------------------- */
  {
    const evidence: string[] = [];
    const firstQuarter = input.emotionTimeline.slice(
      0,
      Math.max(1, Math.floor(input.emotionTimeline.length / 4)),
    );
    let earlyConfusion = 0;
    for (const s of firstQuarter) earlyConfusion = Math.max(earlyConfusion, s.values.confusion);
    const sawOnboarding = input.workflowNodes.some((n) => n.kind === "onboarding");
    const value = 80 - earlyConfusion * 45 + (sawOnboarding ? 10 : 0);
    evidence.push(
      `Peak confusion during the opening minutes: ${(earlyConfusion * 100).toFixed(0)}%.`,
    );
    if (sawOnboarding) evidence.push("An onboarding/welcome flow was present and encountered.");
    setScore("onboarding", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- error recovery -------------------------------------------------- */
  {
    const evidence: string[] = [];
    let value = 85;
    if (errors.length > 0) {
      // Did the operator recover (kept going, frustration subsided) or spiral?
      const recovered = errors.length > 0 && !input.abandoned;
      value = recovered ? 70 - errorRate * 40 : 35 - errorRate * 20;
      evidence.push(`${errors.length} visible error(s) were encountered.`);
      evidence.push(
        recovered
          ? "The operator managed to continue past the errors."
          : "The operator could not recover and abandoned the session.",
      );
      value -= findingPenalty(byCategory("error-recovery"), 20, 10, 4);
    } else {
      evidence.push("No visible errors occurred during the session.");
    }
    setScore("errorRecovery", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- responsiveness --------------------------------------------------- */
  {
    const evidence: string[] = [];
    const latencies = outcomes.map((o) => o.perceivedLatencyMs);
    const slow = latencies.filter((ms) => ms > 2000);
    const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const value =
      95 -
      slow.length * 8 -
      Math.min(25, avg / 100) -
      findingPenalty(byCategory("performance"), 20, 10, 4);
    evidence.push(`Average perceived wait after actions: ${avg.toFixed(0)}ms.`);
    if (slow.length)
      evidence.push(`${slow.length} action(s) left the operator waiting over 2 seconds.`);
    setScore("responsiveness", { value: clamp(value, 0, 100), evidence });
  }

  /* ---- user confidence --------------------------------------------------- */
  {
    const value = clamp(meanEmotion("confidence") * 100, 0, 100);
    setScore("userConfidence", {
      value,
      evidence: [
        `Mean confidence across the session: ${(meanEmotion("confidence") * 100).toFixed(0)}%.`,
        `Final confidence: ${((input.emotionTimeline.at(-1)?.values.confidence ?? 0.5) * 100).toFixed(0)}%.`,
      ],
    });
  }

  /* ---- cognitive load ------------------------------------------------------ */
  {
    // Higher score = lighter load (score is "goodness").
    const loadProxy =
      meanEmotion("confusion") * 0.5 + meanEmotion("fatigue") * 0.3 + meanEmotion("stress") * 0.2;
    setScore("cognitiveLoad", {
      value: clamp((1 - loadProxy) * 100, 0, 100),
      evidence: [
        `Mean confusion ${(meanEmotion("confusion") * 100).toFixed(0)}%, fatigue ${(meanEmotion("fatigue") * 100).toFixed(0)}%, stress ${(meanEmotion("stress") * 100).toFixed(0)}%.`,
      ],
    });
  }
  setScore("trust", {
    value: clamp(meanEmotion("trust") * 100, 0, 100),
    evidence: [
      `Mean trust across the session: ${(meanEmotion("trust") * 100).toFixed(0)}%.`,
      errors.length
        ? `Trust was damaged by ${errors.length} visible error(s).`
        : "No trust-damaging events (errors, broken promises) occurred.",
    ],
  });

  /* ---- overall ----------------------------------------------------------- */
  {
    const weights: Partial<Record<ScoreDimension, number>> = {
      usability: 0.2,
      learnability: 0.1,
      accessibility: 0.1,
      efficiency: 0.1,
      navigation: 0.08,
      workflowQuality: 0.1,
      visualDesign: 0.07,
      errorRecovery: 0.08,
      responsiveness: 0.07,
      userConfidence: 0.05,
      trust: 0.05,
    };
    let total = 0;
    let weightSum = 0;
    for (const [dim, weight] of Object.entries(weights) as [ScoreDimension, number][]) {
      const r = results.get(dim);
      if (r) {
        total += r.value * weight;
        weightSum += weight;
      }
    }
    const criticalCount = bySeverity("critical").length;
    let value = weightSum > 0 ? total / weightSum : 50;
    value -= criticalCount * 8; // critical findings cap the ceiling
    setScore("overall", {
      value: clamp(value, 0, 100),
      evidence: [
        `Weighted composite of ${Object.keys(weights).length} dimensions.`,
        criticalCount
          ? `${criticalCount} critical finding(s) applied an additional penalty.`
          : "No critical findings.",
      ],
    });
  }

  /* ---- registered (domain-pack) dimensions ------------------------------ */
  // Dimensions registered beyond the built-ins (e.g. the MCP pack's
  // `mcp.*`) flow through the same pipeline now that the registries exist
  // at the type level: scored by the generic rule from findings in their
  // linked categories, gated by `appliesTo`, and only reported when there
  // is evidence — a session with no relevant findings simply skips them.
  if (input.modality) {
    for (const entry of dimensionRegistry.listFor(input.modality)) {
      if (entry.builtin || results.has(entry.id)) continue;
      const linkedCategories = findingCategoryRegistry
        .list()
        .filter((c) => c.scoresInto === entry.id)
        .map((c) => c.id);
      const relevant = input.findings.filter((f) => linkedCategories.includes(f.category));
      if (relevant.length === 0) continue;
      const scored = scoreFromFindings(entry.id, relevant);
      results.set(entry.id, { value: scored.value, evidence: [...scored.evidence] });
    }
  }

  return [...results.entries()].map(([dimension, r]) => ({
    dimension: dimension as Score["dimension"],
    value: Math.round(r.value),
    evidence: r.evidence,
  }));
}
