import type { Action, EvidenceProvenance, Prediction, PredictionOutcome } from "../core/types.js";
import {
  BEHAVIOR_MODEL_VERSION,
  implementationRevision,
  PARAMETER_SET_VERSION,
} from "../core/versions.js";
import type { SessionResult } from "../engine/session.js";
import type { PersonaTraits } from "../personas/persona.js";

/**
 * Machine-readable experiment record (reviewer additional requirement).
 *
 * One record per loop iteration, answering:
 *
 * ```text
 * What did EVE see?          → url, stableKey, sensitiveKey
 * What did EVE believe?       → emotion snapshot (cognitive state)
 * What did EVE predict?       → prediction + rationale
 * What did EVE do?            → action + description
 * What happened?              → outcome (surprise, change, error, latency)
 * What evidence supported it? → latencyEvidence, provenance map
 * Observed vs modeled?        → provenance per section + generating params
 * Which parameters?           → persona traits, seed, policy name
 * Human-calibrated?           → calibrationStatus + humanReference slot
 * ```
 *
 * This is the foundation of EVE's eventual calibration dataset: pair each
 * record with a `humanReference` step (same schema, human-observed) and the
 * trajectory/action/dwell comparisons the calibration roadmap needs become
 * computable. Until then every record is explicitly `uncalibrated`.
 */

export type CalibrationStatus = "uncalibrated" | "human-calibrated" | "externally-validated";

/**
 * Paired human step for future trajectory calibration (reviewer §5–7).
 *
 * All fields optional: a pilot dataset may carry only (timestamp, action,
 * outcome), while a full dataset adds targets, coordinates, durations,
 * corrections, transitions, abandonment, self-reports and recovery
 * behavior. EVE-side records never need migration as human data gets
 * richer — only this slot gets filled in.
 */
export interface HumanIterationReference {
  readonly timestampMs?: number;
  /** Free-form: humans act outside EVE's action taxonomy. */
  readonly intendedAction?: string;
  readonly actualAction?: string;
  readonly target?: string;
  readonly coordinates?: { readonly x: number; readonly y: number };
  readonly durationMs?: number;
  readonly outcome?: string;
  readonly correction?: string;
  readonly transition?: string;
  readonly abandonment?: string;
  readonly recovery?: HumanRecovery;
  readonly selfReport?: Readonly<Record<string, number>>;
}

export type HumanRecoveryKind =
  | "retry"
  | "undo"
  | "backtrack"
  | "seek-help"
  | "strategy-change"
  | "pause"
  | "re-read"
  | "confirm"
  | "takeover"
  | "recover-from-error";

export interface HumanRecovery {
  readonly kind: HumanRecoveryKind;
  readonly detail?: string;
}

export interface CalibrationRecord {
  readonly version: 1;
  /** Generating parameters — the complete behavior recipe for this step. */
  readonly seed: number | string;
  readonly persona: string;
  readonly personaTraits: PersonaTraits;
  readonly policy: string;
  readonly step: number;
  readonly timestampMs: number;
  readonly url: string;
  readonly goal: string;
  readonly subgoal: string | null;
  /** Stable structural identity (memory attribution tier). */
  readonly stableKey: string | null;
  /** Sensitive semantic state (workflow/outcome attribution tier). */
  readonly sensitiveKey: string | null;
  readonly actionKind: Action["kind"];
  readonly actionDescription: string;
  readonly rationale: string;
  readonly prediction: Prediction;
  readonly outcome: PredictionOutcome | null;
  readonly emotion: Readonly<Record<string, number>>;
  /**
   * Epistemic status per record section — the OBSERVATION / DERIVATION /
   * SIMULATION / HEURISTIC / LLM-INFERENCE / HUMAN-CALIBRATION distinction
   * as data, not documentation.
   */
  readonly provenance: Readonly<Record<string, EvidenceProvenance>>;
  readonly calibrationStatus: CalibrationStatus;
  /**
   * Versioned model identifiers (reviewer §10): reproducing a prediction
   * requires knowing exactly which cognitive model, parameter set, dataset
   * and surface adapter produced it. `calibrationDatasetVersion` is null
   * until a human dataset exists; `surfaceAdapterVersion` is null when the
   * adapter reports no version.
   */
  readonly behaviorModelVersion: string;
  readonly parameterSetVersion: string;
  readonly calibrationDatasetVersion: string | null;
  readonly surfaceAdapter: string;
  readonly surfaceAdapterVersion: string | null;
  /**
   * Source revision / build id when available (`EVE_IMPLEMENTATION_REVISION`
   * at build time), else null. Completes the reproducibility chain:
   * revision + model version + parameter set + adapter + seed + persona.
   */
  readonly implementationRevision: string | null;
  /**
   * Slot for the paired human step once human traces exist; null until then
   * (reviewer: prefer explicit null over pretending calibration exists).
   * Deliberately richer than current aggregate metrics so recovery and
   * intervention behavior (retry, undo, backtrack, seek-help,
   * strategy-change, takeover, ...) fits without a schema migration.
   */
  readonly humanReference: HumanIterationReference | null;
}

export interface CalibrationDataset {
  readonly version: 1;
  readonly persona: string;
  readonly seed: number | string;
  readonly startUrl: string;
  readonly endReason: string;
  readonly goalAchieved: boolean;
  readonly records: readonly CalibrationRecord[];
  readonly generatedAt: string;
}

function sectionProvenance(
  outcome: PredictionOutcome | null,
): Readonly<Record<string, EvidenceProvenance>> {
  return {
    observation: "observed",
    cognitiveState: "derived",
    prediction: "derived",
    action: "observed",
    outcome: outcome ? "derived" : "modeled",
    latency: outcome?.latencyEvidence
      ? outcome.latencyEvidence.deterministic
        ? "modeled"
        : "observed"
      : "modeled",
    motorTime: "modeled",
    emotionUpdate: "heuristic",
  };
}

/** Build per-step calibration records from a finished session result. */
export function buildCalibrationRecords(
  result: SessionResult,
  opts: {
    personaTraits?: PersonaTraits;
    policy?: string;
    surfaceAdapter?: string;
    surfaceAdapterVersion?: string | null;
  } = {},
): CalibrationRecord[] {
  const traits = opts.personaTraits ?? result.personaTraits;
  if (!traits) {
    throw new Error(
      "buildCalibrationRecords: no persona traits — pass opts.personaTraits or use a SessionResult carrying personaTraits",
    );
  }
  const policy = opts.policy ?? result.policyName ?? "unknown";
  const surfaceAdapter = opts.surfaceAdapter ?? result.surfaceAdapter ?? "unknown";
  const surfaceAdapterVersion = opts.surfaceAdapterVersion ?? result.surfaceAdapterVersion ?? null;
  return result.iterations.map((it) => ({
    version: 1 as const,
    seed: result.seed,
    persona: result.personaName,
    personaTraits: traits,
    policy,
    step: it.step,
    timestampMs: it.timestamp,
    url: it.url,
    goal: it.goal,
    subgoal: it.subgoal,
    stableKey: it.stableKey ?? null,
    sensitiveKey: it.sensitiveKey ?? null,
    actionKind: it.action.kind,
    actionDescription: it.actionDescription,
    rationale: it.rationale,
    prediction: it.prediction,
    outcome: it.outcome,
    emotion: it.emotion,
    provenance: sectionProvenance(it.outcome),
    calibrationStatus: "uncalibrated" as const,
    behaviorModelVersion: BEHAVIOR_MODEL_VERSION,
    parameterSetVersion: PARAMETER_SET_VERSION,
    calibrationDatasetVersion: null,
    surfaceAdapter,
    surfaceAdapterVersion,
    implementationRevision: implementationRevision(),
    humanReference: null,
  }));
}

/** Wrap records with session metadata for dataset export. */
export function buildCalibrationDataset(
  result: SessionResult,
  opts: {
    personaTraits?: PersonaTraits;
    policy?: string;
    surfaceAdapter?: string;
    surfaceAdapterVersion?: string | null;
  } = {},
): CalibrationDataset {
  return {
    version: 1,
    persona: result.personaName,
    seed: result.seed,
    startUrl: result.startUrl,
    endReason: result.endReason,
    goalAchieved: result.goalAchieved,
    records: buildCalibrationRecords(result, opts),
    generatedAt: new Date().toISOString(),
  };
}

/** One JSON object per line — the append-friendly calibration-dataset format. */
export function renderCalibrationRecordsJsonl(records: readonly CalibrationRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}
