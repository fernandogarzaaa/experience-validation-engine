import { clamp01 } from "../core/random.js";
import type { StrategyWeights } from "../planning/strategies.js";
import type { ExplorationStrategy } from "../planning/strategies.js";
import type { CognitiveContext, Decision } from "./cognition.js";
import { HeuristicCognition } from "./heuristicCognition.js";
import { predictInteraction } from "./mentalModel.js";
import { scoreAffordances } from "./salience.js";
import { decisionWeights, evaluateUtilities, softmaxChoice, wantsVerification } from "./utility.js";

/**
 * Utility-based decision policy.
 *
 * Reuses the entire phase-1 priority cascade (dialogs, loading, bailout,
 * reading, strong-goal match, form filling/submission, scroll, backtrack,
 * give up) but replaces the salience-softmax affordance choice with explicit
 * expected-utility evaluation and Luce-choice selection, with feature
 * weights modulated by the current emotional state, trust, fatigue and
 * cross-session recall.
 *
 * Everything else — including keyboard-only handling and hesitation — is
 * inherited unchanged, so this policy is a drop-in decision-model upgrade
 * rather than a rewrite. Enable it with `policy: new UtilityCognition()`.
 */
export class UtilityCognition extends HeuristicCognition {
  override readonly name = "utility";

  constructor(strategy: ExplorationStrategy = "goal-directed") {
    super(strategy);
  }

  protected override chooseAffordance(
    ctx: CognitiveContext,
    goalKeywords: readonly string[],
    _weights: StrategyWeights,
    effortBase: number,
    sig: string,
  ): Decision | null {
    const { persona, emotion, memory } = ctx;

    const scored = scoreAffordances(ctx, goalKeywords).filter((s) => {
      if (s.risk >= 1 && persona.traits.riskTolerance < 0.2) return false;
      return true;
    });
    if (scored.length === 0) return null;

    const weights = decisionWeights(persona, emotion);
    const utilities = evaluateUtilities(scored, weights, {
      pointer: this.lastPointer,
      memorySuccess: ctx.recall
        ? (el) => ctx.recall!(el.text)
        : (el) => (memory.remembersFailure(sig, `click "${el.text.trim()}"`) ? -0.5 : 0),
    });

    // Only consider positive-utility candidates; if none, let the cascade
    // fall through to scroll/backtrack.
    const positive = utilities.filter((u) => u.utility > -0.5);
    if (positive.length === 0) return null;

    const chosen = softmaxChoice(positive, weights, () => ctx.rng.next());
    const el = chosen.element;
    memory.markTried(sig, el.text);
    this.lastPointer = { x: el.box.x + el.box.width / 2, y: el.box.y + el.box.height / 2 };

    // Keyboard-only handling mirrors the base policy.
    if (persona.accessibility.keyboardOnly && !el.focused) {
      return {
        action: { kind: "press", key: "Tab" },
        rationale: "I only use the keyboard — tabbing toward the control I want.",
        prediction: {
          description: "Focus should move to the next control with a visible focus ring.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 0.75,
        },
        effort: effortBase + 0.1,
      };
    }
    if (
      (persona.accessibility.keyboardOnly || persona.traits.keyboardPreference > 0.7) &&
      el.focused
    ) {
      return {
        action: { kind: "press", key: "Enter" },
        rationale: `"${el.text.trim()}" is focused; Enter should activate it.`,
        prediction: predictInteraction(el, "click", this.baseConfidence(ctx)),
        effort: effortBase,
      };
    }

    const verify = wantsVerification(chosen.features.risk, emotion, persona);
    const f = chosen.features;
    const rationale = verify
      ? `"${el.text.trim()}" is consequential and I don't fully trust this yet — I'll proceed but I'm watching closely (utility ${chosen.utility.toFixed(2)}).`
      : f.reward > 0.4
        ? `Best expected payoff for "${el.text.trim()}" toward ${ctx.goals.current.description} (utility ${chosen.utility.toFixed(2)}).`
        : f.curiosity > 0.4
          ? `"${el.text.trim()}" is the most worthwhile thing to explore right now (utility ${chosen.utility.toFixed(2)}).`
          : `Weighing effort, risk and payoff, "${el.text.trim()}" is my best move (utility ${chosen.utility.toFixed(2)}).`;

    return {
      action: { kind: "click", target: el },
      rationale,
      prediction: predictInteraction(el, "click", this.baseConfidence(ctx)),
      effort: clamp01(effortBase + chosen.features.effort * 0.3 + (verify ? 0.15 : 0)),
    };
  }

  private lastPointer: { x: number; y: number } | null = null;
}
