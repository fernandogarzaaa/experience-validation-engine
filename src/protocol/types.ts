/**
 * CP/1 canonical types, as EVE sees them.
 *
 * EVE owns three: {@link Observation}, {@link Experience} and
 * {@link FitnessResult}. It reads {@link Mutation} and {@link ValidationRequest}
 * to know what to measure. Those five are declared here in full.
 *
 * The remaining canonical types (Genome, Belief, Memory, Skill, Identity,
 * Capability, Reflection, Context) are ADAM's or AXIOM's to author and EVE
 * never handles them, so they are deliberately absent: a declaration EVE never
 * uses would still have to be kept in step with the schema forever. Agreement
 * on those types is established structurally, over the shared fixture corpus,
 * by the conformance suite — which tests the encoding, the thing that actually
 * has to match across bindings.
 *
 * See `protocol/cp1/SPEC.md` section 3.
 */

/** Which repository authored a document. Authorship is exclusive per type. */
export type Component = "adam" | "eve" | "axiom" | "pcr";

/** Chain of custody. Mandatory on every CP/1 document. */
export interface Provenance {
  readonly authored_by: Component;
  /** RFC 3339 UTC, millisecond precision. */
  readonly produced_at: string;
  readonly origin: string;
  readonly evidence: readonly string[];
  /** Ids of the documents this one was computed from. */
  readonly derived_from: readonly string[];
  /** SHA-256 over the canonical document with this member removed. */
  readonly content_hash: string;
}

export type Surface = "web" | "mobile" | "cli" | "api" | "mock";

export interface PerceivedAffordance {
  readonly label: string;
  readonly role: string;
  readonly enabled: boolean;
}

/**
 * One perceived fact about an environment at a point in time.
 *
 * Restricted to what an operator could actually perceive — no DOM internals,
 * no network traces, no source. That restriction is what makes an Observation
 * evidence about experience rather than about implementation.
 */
export interface Observation {
  readonly cp: "cp1";
  readonly type: "Observation";
  readonly id: string;
  readonly environment_id: string;
  readonly surface: Surface;
  readonly at: string;
  readonly locator?: string;
  readonly title?: string;
  readonly signals: readonly string[];
  readonly affordances: readonly PerceivedAffordance[];
  readonly latency_ms: number;
  readonly error_perceived: boolean;
  readonly provenance: Provenance;
}

/**
 * The CP/1 canonical action verbs. This set is closed on the wire: adding a
 * verb changes the canonical form and is a protocol version change (SPEC §8),
 * not an edit here. Engine-side verbs beyond this set live in
 * `actionVerbRegistry` (`src/protocol/verbs.ts`) and never serialize into an
 * `Experience`.
 */
export const EXPERIENCE_ACTIONS = [
  "click",
  "type",
  "press",
  "scroll",
  "navigate",
  "back",
  "read",
  "wait",
  "abandon",
] as const;

export type ExperienceAction = (typeof EXPERIENCE_ACTIONS)[number];

export type ExperienceOutcome = "success" | "surprise" | "error" | "no_change" | "abandoned";

/**
 * An observation situated in intent.
 *
 * An observation alone is not experience: experience is the gap between what
 * was predicted and what happened, which is what drives learning.
 */
export interface Experience {
  readonly cp: "cp1";
  readonly type: "Experience";
  readonly id: string;
  readonly observation_id: string;
  readonly step: number;
  readonly goal: string;
  readonly action: ExperienceAction;
  readonly action_description: string;
  readonly prediction: {
    readonly description: string;
    readonly confidence_bp: number;
    readonly expects_change: boolean;
  };
  readonly outcome: ExperienceOutcome;
  readonly surprise_bp: number;
  readonly affect: {
    readonly frustration_bp: number;
    readonly trust_bp: number;
    readonly confidence_bp: number;
  };
  readonly provenance: Provenance;
}

export type MutationKind =
  | "amend_genome"
  | "retire_skill"
  | "reconcile_belief"
  | "investigate_conflict";

export type MutationStatus = "proposed" | "validating" | "accepted" | "rejected";

/** A proposed change to genome, skills or beliefs. Authored by ADAM; read here. */
export interface Mutation {
  readonly cp: "cp1";
  readonly type: "Mutation";
  readonly id: string;
  readonly kind: MutationKind;
  readonly target: string;
  readonly current_value?: string;
  readonly proposed_value?: string;
  readonly rationale: string;
  readonly confidence_bp: number;
  readonly risk_bp: number;
  readonly status: MutationStatus;
  readonly provenance: Provenance;
}

/** ADAM asks EVE to measure a mutation. */
export interface ValidationRequest {
  readonly cp: "cp1";
  readonly type: "ValidationRequest";
  readonly id: string;
  readonly mutation: Mutation;
  readonly genome_before_hash: string;
  readonly genome_after_hash: string;
  readonly scenario_ids: readonly string[];
  readonly seed: number;
  readonly trials: number;
  readonly provenance: Provenance;
}

/**
 * One side of a counterfactual fitness comparison.
 *
 * `composite_bp` and `runs` are the whole of what an evaluator must report: a
 * scalar objective in basis points, higher-is-better, and how many executions
 * stand behind it. The four experience members are EVE's objective, and are
 * optional because the other evaluator has no simulated human to have a
 * frustration level — requiring them would be requiring it to invent the
 * number. Absent means *not measured*; it never means zero.
 *
 * EVE always reports all six, so nothing on this side of the wire changes.
 */
export interface Measurement {
  readonly composite_bp: number;
  readonly task_success_bp?: number;
  readonly frustration_bp?: number;
  readonly trust_bp?: number;
  readonly cognitive_load_bp?: number;
  readonly runs: number;
}

export type Recommendation = "approve" | "needs_review" | "reject";

/**
 * Evidence-backed measurement of a mutation.
 *
 * Fitness is counterfactual: baseline and candidate are measured over the same
 * scenarios with the same seed, so the only difference between them is the
 * mutation. An absolute score would be uninterpretable.
 */
export interface FitnessResult {
  readonly cp: "cp1";
  readonly type: "FitnessResult";
  readonly id: string;
  readonly mutation_id: string;
  readonly seed: number;
  readonly scenario_ids: readonly string[];
  readonly trials: number;
  readonly baseline: Measurement;
  readonly candidate: Measurement;
  /** candidate.composite_bp - baseline.composite_bp. Signed. */
  readonly delta_bp: number;
  readonly recommendation: Recommendation;
  readonly reason: string;
  readonly provenance: Provenance;
}

/** Every event the organism can emit. The set is closed. */
export const EVENT_KINDS = [
  "ObservationRecorded",
  "ExperienceCreated",
  "ContextCompressed",
  "GroundingFailed",
  "MemoryConsolidated",
  "BeliefUpdated",
  "SkillLearned",
  "ReflectionCompleted",
  "MutationProposed",
  "SimulationCompleted",
  "TaskRunCompleted",
  "FitnessMeasured",
  "MutationAccepted",
  "MutationRejected",
  "GenomeCommitted",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

export const SUBJECT_TYPES = [
  "Identity",
  "Genome",
  "Capability",
  "Belief",
  "Memory",
  "Skill",
  "Mutation",
  "Reflection",
  "Observation",
  "Experience",
  "FitnessResult",
  "Context",
] as const;

export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * A payload member. Scalars only, so an event log stays cheap enough to always
 * be on.
 *
 * The schema declares `["string", "integer", "boolean"]`, and the canonical
 * encoder rejects non-integer numbers — so a `number` here is only ever valid
 * when it is a safe integer. TypeScript cannot express that as a type, so the
 * alias is named to say it and {@link isPayloadValue} checks it at runtime.
 */
export type PayloadValue = string | number | boolean;

/** Whether a value is a payload member the canonical encoder will accept. */
export function isPayloadValue(value: unknown): value is PayloadValue {
  if (typeof value === "string" || typeof value === "boolean") return true;
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** One announced fact. */
export interface CpEvent {
  readonly cp: "cp1";
  readonly type: EventKind;
  readonly id: string;
  readonly occurred_at: string;
  readonly actor: Component;
  readonly subject_id: string;
  readonly subject_type: SubjectType;
  /** Shared by every event of one developmental turn. */
  readonly correlation_id: string;
  /** The event that caused this one, making a turn a tree rather than a bag. */
  readonly causation_id?: string;
  readonly payload: Readonly<Record<string, PayloadValue>>;
  readonly provenance: Provenance;
}

/**
 * The components permitted to emit each event. Ownership of an event follows
 * ownership of the concept it announces, so this is checkable: an
 * `ObservationRecorded` from ADAM means ADAM minted an EVE-owned fact.
 *
 * Fourteen of the fifteen kinds have exactly one permitted emitter.
 * `FitnessMeasured` has two, because two independent evaluators can honestly
 * score a mutation — EVE against simulated experience, PCR against the real
 * objective — and a single `Component` here could only answer by naming the
 * wrong one for the other. The permission stays closed: two named components,
 * not "anyone". Mirrors `EventKind::emitters` on the Rust side.
 */
export const EVENT_EMITTER: Readonly<Record<EventKind, readonly Component[]>> = {
  ObservationRecorded: ["eve"],
  ExperienceCreated: ["eve"],
  SimulationCompleted: ["eve"],
  TaskRunCompleted: ["pcr"],
  FitnessMeasured: ["eve", "pcr"],
  ContextCompressed: ["axiom"],
  GroundingFailed: ["axiom"],
  MemoryConsolidated: ["adam"],
  BeliefUpdated: ["adam"],
  SkillLearned: ["adam"],
  ReflectionCompleted: ["adam"],
  MutationProposed: ["adam"],
  MutationAccepted: ["adam"],
  MutationRejected: ["adam"],
  GenomeCommitted: ["adam"],
};
