import type { KernelPercept } from "../core/kernel.js";
import type { Rng } from "../core/random.js";
import type { Action, Percept, Prediction } from "../core/types.js";
import type { EmotionVector } from "../emotion/emotionalState.js";
import type { OperatorMemory } from "../memory/memory.js";
import type { Persona } from "../personas/persona.js";
import type { GoalStack } from "../planning/goals.js";

/**
 * Everything the deciding mind has access to at one moment. Note what is
 * absent: no DOM handles, no network state, no application internals — only
 * the current percept and the operator's own internal state.
 */
export interface CognitiveContext {
  readonly percept: Percept;
  readonly previousPercept: Percept | null;
  readonly persona: Persona;
  readonly emotion: Readonly<EmotionVector>;
  readonly memory: OperatorMemory;
  readonly goals: GoalStack;
  readonly rng: Rng;
  readonly step: number;
  /** Ms elapsed since session start. */
  readonly elapsedMs: number;

  /**
   * Phase 2: the kernel view of the current percept (`src/core/kernel.ts`).
   * On kernel-native surfaces (MCP) this is the real thing — typed
   * affordances and signals; on legacy adapters it is the projection of
   * `percept` (`kernelFromWebPercept`), so policies can consume one shape
   * uniformly. Optional so existing policies and tests are unaffected.
   */
  readonly kernel?: KernelPercept;

  /* --- Optional phase-2 enrichments (populated when the enhanced cognitive
     suite is enabled; phase-1 policies ignore them). --- */

  /** Current overall trust in the application, 0..1. */
  readonly trust?: number;
  /** Extraneous cognitive load index (0..100) of the current screen. */
  readonly cognitiveLoadIndex?: number;
  /** Accumulated decision fatigue, 0..1. */
  readonly decisionFatigue?: number;
  /**
   * Cross-session recall for an element label: 0..1 belief, from long-term
   * memory, that acting on this label previously led somewhere useful.
   */
  readonly recall?: (label: string) => number;
}

export interface Decision {
  readonly action: Action;
  /** First-person reasoning, e.g. "That button says Save, I expect a confirmation." */
  readonly rationale: string;
  readonly prediction: Prediction;
  /** Estimated cognitive effort of making this decision, 0..1. */
  readonly effort: number;
}

/**
 * A decision policy is the operator's "mind": given what they perceive and
 * everything they carry inside, produce the next intent. EVE ships a
 * heuristic policy (deterministic, offline, persona-driven) and an optional
 * LLM-backed policy; both honor the same contract.
 */
export interface DecisionPolicy {
  readonly name: string;
  decide(ctx: CognitiveContext): Promise<Decision>;
}

/**
 * Optional capability: a policy that can silently degrade to a fallback
 * implementation (e.g. `LlmCognition` degrading to `HeuristicCognition`) and
 * wants the degradation surfaced rather than left invisible. `takeFallbackReason`
 * is consumed on read — it returns the most recent reason once, then `null`,
 * so a caller polling every step reports each degradation exactly once.
 */
export interface FallbackReportingPolicy {
  takeFallbackReason(): string | null;
}

/** Narrows to {@link FallbackReportingPolicy} if `policy` implements it, else `null`. */
export function asFallbackReportingPolicy(policy: unknown): FallbackReportingPolicy | null {
  if (
    typeof policy === "object" &&
    policy !== null &&
    "takeFallbackReason" in policy &&
    typeof (policy as { takeFallbackReason: unknown }).takeFallbackReason === "function"
  ) {
    return policy as FallbackReportingPolicy;
  }
  return null;
}
