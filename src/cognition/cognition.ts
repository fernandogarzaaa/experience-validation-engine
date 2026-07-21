import type { Action, Percept, Prediction } from "../core/types.js";
import type { Rng } from "../core/random.js";
import type { Persona } from "../personas/persona.js";
import type { EmotionVector } from "../emotion/emotionalState.js";
import type { OperatorMemory } from "../memory/memory.js";
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
