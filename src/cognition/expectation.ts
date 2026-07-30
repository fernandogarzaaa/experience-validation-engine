import { clamp01 } from "../core/random.js";
import type { Percept, Prediction, VisibleElement } from "../core/types.js";
import { screenSignature } from "../memory/memory.js";
import { tokenize, visibleText } from "./mentalModel.js";

/**
 * Expectation engine.
 *
 * Extends the phase-1 prediction (a single expected-outcome string plus
 * signals) into a full multi-dimensional expectation, per predictive-
 * processing accounts of perception (Clark 2013): before acting, the
 * operator commits to what should happen, what should appear, how long it
 * should take, where they should arrive, what visual change should occur,
 * and what feedback should appear. After observation each dimension is
 * scored, yielding an Expectation Match Score, Expectation Surprise, and a
 * per-violation severity (expectation-disconfirmation; Oliver 1980).
 */

export interface RichExpectation {
  readonly base: Prediction;
  /** Where the operator expects to arrive: same screen, new screen, or a specific place. */
  readonly destination: "same" | "new" | "back" | { titleHint: string };
  /** Expected perceived latency in ms (Doherty threshold ≈ 400ms baseline). */
  readonly expectedLatencyMs: number;
  /** Whether a visible layout/content change is expected. */
  readonly expectsVisualChange: boolean;
  /** Whether explicit feedback (message/confirmation) is expected. */
  readonly expectsFeedback: boolean;
}

export interface ExpectationScore {
  /** 0..1, 1 = reality matched the expectation exactly. */
  readonly matchScore: number;
  /** 0..1, prediction error. */
  readonly surprise: number;
  /** 0..1, how badly the most-violated dimension missed. */
  readonly violationSeverity: number;
  /** Which dimensions were violated. */
  readonly violations: readonly ExpectationDimension[];
  readonly perceivedLatencyMs: number;
}

export type ExpectationDimension =
  | "outcome"
  | "destination"
  | "latency"
  | "visual-change"
  | "feedback";

const FEEDBACK_RE =
  /\b(saved|sent|success|done|added|created|updated|deleted|removed|confirmed|thank you|welcome|copied|applied|error|failed|invalid|required)\b/i;

/**
 * Build a rich expectation from a base prediction and the element being
 * acted on. Latency expectations scale with the perceived "weight" of the
 * action — navigation and submission feel like they should take longer than
 * toggling a checkbox.
 */
export function buildExpectation(
  base: Prediction,
  target: VisibleElement | null,
  actionKind: string,
): RichExpectation {
  const label = target?.text ?? "";
  const navigational =
    target?.role === "link" ||
    target?.role === "tab" ||
    target?.role === "menuitem" ||
    /\b(next|continue|log ?in|sign ?in|sign ?up|submit|go|open|view|settings|dashboard)\b/i.test(
      label,
    );
  const committing = /\b(save|submit|pay|create|send|confirm|delete|remove|publish|order)\b/i.test(
    label,
  );

  let destination: RichExpectation["destination"] = "same";
  if (actionKind === "back") destination = "back";
  else if (navigational) destination = "new";
  else if (base.expectsChange) destination = "same";

  // Doherty threshold ~400ms; weightier actions get more tolerance.
  const expectedLatencyMs = committing ? 1500 : navigational ? 900 : 400;

  return {
    base,
    destination,
    expectedLatencyMs,
    expectsVisualChange: base.expectsChange,
    expectsFeedback: committing || FEEDBACK_RE.test(label),
  };
}

/**
 * Score a rich expectation against what actually happened.
 */
export function scoreExpectation(
  expectation: RichExpectation,
  before: Percept,
  after: Percept,
  perceivedLatencyMs: number,
): ExpectationScore {
  const violations: ExpectationDimension[] = [];
  const dimScores: Record<ExpectationDimension, number> = {
    outcome: 1,
    destination: 1,
    latency: 1,
    "visual-change": 1,
    feedback: 1,
  };

  const beforeSig = screenSignature(before);
  const afterSig = screenSignature(after);
  const changed = beforeSig !== afterSig;
  const afterText = visibleText(after).toLowerCase();

  // Outcome: expected signals present?
  const signals = expectation.base.expectedSignals;
  if (signals.length > 0) {
    const hit = signals.filter((s) => afterText.includes(s.toLowerCase())).length / signals.length;
    dimScores.outcome = hit;
    if (hit < 0.5) violations.push("outcome");
  }

  // Destination.
  const destOk = (() => {
    switch (expectation.destination) {
      case "same":
        return !changed || afterSig === beforeSig ? 1 : 0.3;
      case "new":
        return changed ? 1 : 0;
      case "back":
        return changed ? 1 : 0.5;
      default: {
        return after.title.toLowerCase().includes(expectation.destination.titleHint.toLowerCase())
          ? 1
          : changed
            ? 0.5
            : 0;
      }
    }
  })();
  dimScores.destination = destOk;
  if (destOk < 0.5) violations.push("destination");

  // Latency.
  const latencyRatio = perceivedLatencyMs / Math.max(200, expectation.expectedLatencyMs);
  const latencyScore = latencyRatio <= 1 ? 1 : clamp01(1 - (latencyRatio - 1) * 0.4);
  dimScores.latency = latencyScore;
  if (latencyScore < 0.5) violations.push("latency");

  // Visual change.
  if (expectation.expectsVisualChange) {
    dimScores["visual-change"] = changed || significantChange(before, after) ? 1 : 0;
    if (dimScores["visual-change"] < 0.5) violations.push("visual-change");
  }

  // Feedback.
  if (expectation.expectsFeedback) {
    const gotFeedback = FEEDBACK_RE.test(afterText) || after.dialogs.length > 0;
    dimScores.feedback = gotFeedback ? 1 : 0.2;
    if (!gotFeedback) violations.push("feedback");
  }

  const active = (Object.keys(dimScores) as ExpectationDimension[]).filter((d) => {
    if (d === "outcome") return signals.length > 0;
    if (d === "visual-change") return expectation.expectsVisualChange;
    if (d === "feedback") return expectation.expectsFeedback;
    return true;
  });
  const matchScore = active.reduce((s, d) => s + dimScores[d], 0) / Math.max(1, active.length);
  const violationSeverity =
    violations.length === 0 ? 0 : 1 - Math.min(...violations.map((d) => dimScores[d]));

  return {
    matchScore: Number(matchScore.toFixed(3)),
    surprise: Number((1 - matchScore).toFixed(3)),
    violationSeverity: Number(violationSeverity.toFixed(3)),
    violations,
    perceivedLatencyMs,
  };
}

function significantChange(before: Percept, after: Percept): boolean {
  const a = new Set(tokenize(visibleText(before)));
  const b = new Set(tokenize(visibleText(after)));
  if (a.size === 0 && b.size === 0) return false;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? false : inter / union < 0.75;
}

/**
 * Tracks streaks of expectation violations. Repeated violations compound
 * frustration and trust damage beyond isolated ones (learned
 * unpredictability).
 */
export class ViolationStreak {
  private streak = 0;
  private total = 0;

  register(score: ExpectationScore): number {
    if (score.violationSeverity > 0.4) {
      this.streak += 1;
      this.total += 1;
    } else {
      this.streak = 0;
    }
    return this.streak;
  }

  current(): number {
    return this.streak;
  }

  totalViolations(): number {
    return this.total;
  }
}
