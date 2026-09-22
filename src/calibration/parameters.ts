/**
 * Behavioral parameter registry (Phase 5 calibration substrate).
 *
 * Answers "which behavioral parameters generated this run?" without
 * grepping source. Every entry is classified:
 *
 * - STRUCTURAL: semantics/invariants defining what EVE is. Not fittable
 *   (fitting them would change the instrument's meaning, not its tuning).
 * - EMPIRICAL: hand-authored today, potentially fittable against human
 *   behavioral data once a calibration dataset exists. Bounds are sane
 *   prior ranges for future fitting — explicitly NOT fitted values.
 * - POLICY: deployment/configuration behavior. Set per run, never fitted.
 *
 * READ-ONLY in the frozen model (v1.0.0): this registry DESCRIBES values,
 * it does not configure them. Nothing here is wired as a live knob —
 * doing so would change behavior and require a model version bump.
 * `snapshotParameters()` serializes the set for dataset manifests.
 */

export type ParameterClassification = "STRUCTURAL" | "EMPIRICAL" | "POLICY";

export interface ParameterBounds {
  readonly min: number;
  readonly max: number;
}

export interface ParameterDefinition {
  /** Stable id, e.g. "motor.clickScatterPxPerUnit". */
  readonly id: string;
  /** Owning module, e.g. "browser/humanizer". */
  readonly owner: string;
  readonly classification: ParameterClassification;
  readonly value: number | string;
  readonly units?: string;
  /**
   * Prior range placeholder for future fitting (EMPIRICAL only).
   * Hand-authored sanity bounds — not posteriors, not fitted.
   */
  readonly bounds?: ParameterBounds;
  readonly description: string;
  /** Source pointer for auditability, e.g. "src/browser/humanizer.ts:61". */
  readonly source: string;
}

export interface ParameterSet {
  readonly parameterSetVersion: string;
  readonly parameters: readonly ParameterDefinition[];
}

const E = (
  id: string,
  owner: string,
  value: number,
  bounds: ParameterBounds,
  description: string,
  source: string,
  units?: string,
): ParameterDefinition => ({
  id,
  owner,
  classification: "EMPIRICAL",
  value,
  bounds,
  description,
  source,
  ...(units ? { units } : {}),
});

/**
 * The frozen v1.0.0 empirical + structural + policy parameter surface.
 * Values mirror the implementation; `source` points at each one. The
 * regression test `parameters.test.ts` re-derives every computable value
 * from its source function so mirrors cannot silently drift.
 */
export const BEHAVIOR_PARAMETERS: readonly ParameterDefinition[] = [
  // -- motor behavior (browser/humanizer) --
  E(
    "motor.clickScatterPxPerUnit",
    "browser/humanizer",
    14,
    { min: 4, max: 30 },
    "Gaussian click-scatter sigma per unit of (1 - clickAccuracy), px",
    "src/browser/humanizer.ts:clickScatterPx",
    "px",
  ),
  E(
    "motor.typoBaseRate",
    "browser/humanizer",
    0.02,
    { min: 0, max: 0.1 },
    "Per-character typo floor even at typingAccuracy 1",
    "src/browser/humanizer.ts:planTyping",
    "probability",
  ),
  E(
    "motor.typoAccuracyRate",
    "browser/humanizer",
    0.05,
    { min: 0, max: 0.2 },
    "Additional typo rate per unit of (1 - typingAccuracy)",
    "src/browser/humanizer.ts:planTyping",
    "probability",
  ),
  E(
    "motor.softKeyboardTypoMultiplier",
    "browser/humanizer",
    1.8,
    { min: 1, max: 3 },
    "Typo-rate multiplier on soft keyboards",
    "src/browser/humanizer.ts:planSoftKeyType",
    "multiplier",
  ),
  E(
    "motor.misclickClickThresholdPx",
    "browser/humanizer",
    10,
    { min: 2, max: 40 },
    "Near-miss correction radius for mouse (device-level heuristic)",
    "src/browser/humanizer.ts:CLICK_MISCLICK_POLICY",
    "px",
  ),
  E(
    "motor.misclickTapThresholdPx",
    "browser/humanizer",
    12,
    { min: 2, max: 60 },
    "Near-miss correction radius for touch (device-level heuristic)",
    "src/browser/humanizer.ts:TAP_MISCLICK_POLICY",
    "px",
  ),
  E(
    "motor.misclickScatterMultiple",
    "browser/humanizer",
    1.5,
    { min: 0.5, max: 4 },
    "Scatter multiple competing with the px threshold",
    "src/browser/humanizer.ts:missDisposition",
    "multiplier",
  ),
  E(
    "motor.hesitationMsPerRisk",
    "browser/humanizer",
    1800,
    { min: 200, max: 5000 },
    "Hesitation pause per unit of action risk",
    "src/browser/humanizer.ts:hesitationMs",
    "ms",
  ),
  E(
    "motor.swipeMomentumDecay",
    "browser/humanizer",
    0.55,
    { min: 0.2, max: 0.9 },
    "Per-segment distance decay of modeled swipe momentum",
    "src/browser/humanizer.ts:planSwipe",
    "ratio",
  ),
  // -- trust / emotion --
  E(
    "trust.gain",
    "emotion/trust",
    0.06,
    { min: 0.01, max: 0.3 },
    "Trust increment on positive evidence (slow building)",
    "src/emotion/trust.ts:GAIN",
  ),
  E(
    "trust.loss",
    "emotion/trust",
    0.16,
    { min: 0.02, max: 0.5 },
    "Trust decrement on violations (negativity asymmetry)",
    "src/emotion/trust.ts:LOSS",
  ),
  // -- abandonment --
  E(
    "abandon.frustrationBase",
    "personas/persona",
    0.55,
    { min: 0.3, max: 0.9 },
    "Frustration level triggering abandonment at patience 0",
    "src/personas/persona.ts:abandonmentThreshold",
    "frustration 0..1",
  ),
  E(
    "abandon.frustrationPatienceRange",
    "personas/persona",
    0.4,
    { min: 0, max: 0.45 },
    "Additional abandonment tolerance per unit of patience",
    "src/personas/persona.ts:abandonmentThreshold",
    "frustration 0..1",
  ),
  // -- choice --
  E(
    "choice.salienceViabilityThreshold",
    "cognition/heuristicCognition",
    0.05,
    { min: 0, max: 0.5 },
    "Minimum salience total for affordance candidacy",
    "src/cognition/heuristicCognition.ts:chooseAffordance",
    "salience",
  ),
  E(
    "choice.softmaxUrgencyBase",
    "cognition/utility",
    0.55,
    { min: 0.2, max: 1 },
    "Softmax temperature base (shrinks with urgency)",
    "src/cognition/utility.ts:softmaxDistribution",
  ),
  E(
    "choice.softmaxMinTemperature",
    "cognition/utility",
    0.12,
    { min: 0.01, max: 0.5 },
    "Softmax temperature floor under maximum urgency",
    "src/cognition/utility.ts:softmaxDistribution",
  ),
  // -- memory --
  E(
    "memory.episodicDecayBase",
    "memory/memory",
    0.97,
    { min: 0.9, max: 1 },
    "Per-step episodic strength retention at retention 0",
    "src/memory/memory.ts:decayEpisodes",
    "ratio",
  ),
  // -- operational estimates (explicitly heuristic) --
  E(
    "estimate.supportFrustrationWeight",
    "predict/predict",
    0.3,
    { min: 0, max: 1 },
    "Hand weight of frustration in the support-contact heuristic",
    "src/predict/predict.ts:predictUX",
    "weight",
  ),
  E(
    "estimate.supportAbandonmentWeight",
    "predict/predict",
    0.5,
    { min: 0, max: 1 },
    "Hand weight of abandonment in the support-contact heuristic",
    "src/predict/predict.ts:predictUX",
    "weight",
  ),
  E(
    "estimate.supportBrokenWeight",
    "predict/predict",
    0.2,
    { min: 0, max: 1 },
    "Hand weight of broken-interaction prevalence in the heuristic",
    "src/predict/predict.ts:predictUX",
    "weight",
  ),
  // -- structural invariants (not fittable) --
  {
    id: "invariant.nativeDialogDismissDefault",
    owner: "browser/adapters",
    classification: "STRUCTURAL",
    value: "dismiss",
    description: "Blocking native dialogs unblock via dismiss unless explicitly accepted",
    source: "src/browser/nativeDialog.ts",
  },
  {
    id: "invariant.passwordMasking",
    owner: "browser/perceptionScript",
    classification: "STRUCTURAL",
    value: "masked",
    description: "Password input values never enter percepts as seen text",
    source: "src/browser/perceptionScript.ts:directText",
  },
  {
    id: "invariant.deterministicWallExclusion",
    owner: "engine/timing",
    classification: "STRUCTURAL",
    value: "excluded",
    description: "Wall-clock noise never enters deterministic trajectories or appraisal",
    source: "src/engine/timing.ts:latencyEvidenceFor",
  },
  {
    id: "invariant.noProbabilitiesWithoutSoftmax",
    owner: "cognition/choiceSet",
    classification: "STRUCTURAL",
    value: "enforced",
    description: "Selection probabilities recorded only from a real softmax distribution",
    source: "src/cognition/choiceSet.ts",
  },
  // -- policy (deployment configuration, never fitted) --
  {
    id: "policy.maxStepsDefault",
    owner: "engine/session",
    classification: "POLICY",
    value: 60,
    units: "steps",
    description: "Default step budget when the caller sets none",
    source: "src/engine/session.ts:run",
  },
  {
    id: "policy.paceScaleDefault",
    owner: "engine/session",
    classification: "POLICY",
    value: 0.15,
    description: "Default real-time pacing multiplier for live browsers",
    source: "src/engine/session.ts:run",
  },
  {
    id: "policy.screenshotsDefault",
    owner: "engine/session",
    classification: "POLICY",
    value: "off",
    description: "Screenshots captured only when explicitly enabled",
    source: "src/engine/session.ts:run",
  },
];

export function getParameter(id: string): ParameterDefinition | undefined {
  return BEHAVIOR_PARAMETERS.find((p) => p.id === id);
}

export function parametersByClass(
  classification: ParameterClassification,
): readonly ParameterDefinition[] {
  return BEHAVIOR_PARAMETERS.filter((p) => p.classification === classification);
}

/** Serializable snapshot answering "which parameters generated this run?". */
export function snapshotParameters(parameterSetVersion: string): {
  readonly parameterSetVersion: string;
  readonly parameters: readonly { id: string; value: number | string }[];
} {
  return {
    parameterSetVersion,
    parameters: BEHAVIOR_PARAMETERS.map((p) => ({ id: p.id, value: p.value })),
  };
}
