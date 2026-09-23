import { stableIdentityKey } from "../memory/surfaceIdentity.js";
import type { CognitiveContext, Decision, DecisionPolicy } from "./cognition.js";
import { predictInteraction } from "./mentalModel.js";

/**
 * Baseline policies (Phase 12 calibration substrate).
 *
 * Deliberately dumb comparison policies implementing the standard
 * `DecisionPolicy` contract, so future model comparison can ask whether
 * EVE's cognitive architecture outperforms simpler models on held-out
 * human behavior:
 *
 * - `RandomPolicy`: uniform choice among currently interactive controls.
 * - `GoalGreedyPolicy`: first goal-relevant untried control, else first
 *   untried control, else wait. No salience, no utility, no memory model.
 *
 * Both are seeded-deterministic (all randomness through `ctx.rng`) and
 * record NO choice sets — a baseline that scored its own candidates would
 * stop being a baseline. Complexity is never assumed better; that is what
 * the comparison is for.
 */

function candidatesOf(ctx: CognitiveContext) {
  return ctx.percept.elements.filter((el) => el.interactive && !el.disabled);
}

/** Uniform random choice among interactive controls; waits when none exist. */
export class RandomPolicy implements DecisionPolicy {
  readonly name = "random-baseline";

  async decide(ctx: CognitiveContext): Promise<Decision> {
    const candidates = candidatesOf(ctx);
    if (candidates.length === 0) {
      return {
        action: { kind: "wait", durationMs: 500 },
        rationale: "Baseline: nothing actionable; waiting.",
        prediction: {
          description: "Waiting changes nothing.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 0.5,
        },
        effort: 0,
      };
    }
    const el = candidates[Math.floor(ctx.rng.next() * candidates.length)]!;
    return {
      action: { kind: "click", target: el },
      rationale: `Baseline: uniform random choice ("${el.text.trim()}").`,
      prediction: predictInteraction(el, "click", 0.5),
      effort: 0,
    };
  }
}

/**
 * Goal-greedy choice: first untried control whose label overlaps the goal,
 * else first untried control, else wait. No salience weighting, no
 * softmax, no memory beyond tried-marks.
 */
export class GoalGreedyPolicy implements DecisionPolicy {
  readonly name = "goal-greedy-baseline";

  async decide(ctx: CognitiveContext): Promise<Decision> {
    const candidates = candidatesOf(ctx);
    // Screen-scoped tried marks: a label tried on screen A must not
    // suppress it on screen B. Only the current screen's node counts —
    // cross-screen leakage would let stale familiarity veto fresh options.
    const node = ctx.memory
      .knownScreens()
      .find((s) => s.signature === stableIdentityKey(ctx.percept));
    const tried = new Set(node?.triedAffordances ?? []);
    const untried = candidates.filter((el) => !tried.has(el.text.trim().toLowerCase()));
    const pool = untried.length > 0 ? untried : candidates;
    if (pool.length === 0) {
      return {
        action: { kind: "wait", durationMs: 500 },
        rationale: "Baseline: nothing actionable; waiting.",
        prediction: {
          description: "Waiting changes nothing.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 0.5,
        },
        effort: 0,
      };
    }
    const keywords = new Set([...ctx.goals.current.keywords, ...ctx.goals.root.keywords]);
    const hit = pool.find((el) =>
      el.text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .some((t) => keywords.has(t)),
    );
    const el = hit ?? pool[0]!;
    return {
      action: { kind: "click", target: el },
      rationale: hit
        ? `Baseline: first goal-matching control ("${el.text.trim()}").`
        : `Baseline: first available control ("${el.text.trim()}").`,
      prediction: predictInteraction(el, "click", 0.5),
      effort: 0,
    };
  }
}
