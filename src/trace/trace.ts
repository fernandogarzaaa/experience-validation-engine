import { seedFromString } from "../core/random.js";
import type {
  Action,
  ChoiceSet,
  EvidenceProvenance,
  LatencyEvidence,
  Percept,
  PerceptSnapshot,
  Prediction,
  PredictionOutcome,
} from "../core/types.js";
import {
  BEHAVIOR_MODEL_VERSION,
  implementationRevision,
  PARAMETER_SET_VERSION,
} from "../core/versions.js";
import type { SessionResult } from "../engine/session.js";
import type { PersonaTraits } from "../personas/persona.js";

/**
 * First-class experience trace (Phase 1 calibration substrate).
 *
 * A trace is the canonical ordered behavioral trajectory: every action with
 * its before/after states, choice context, prediction, outcome, timing,
 * affect, and provenance — plus identity (trace/session/task/model/
 * environment) and a genuine terminal observation. It is built purely from
 * a finished `SessionResult` (no engine changes required to consume it),
 * serializes deterministically, and uses explicit nulls wherever evidence
 * is absent instead of fabricated measurements.
 *
 * Relationship to `CalibrationRecord` (which is preserved, not replaced):
 *
 * ```text
 * ExperienceTrace  (canonical primitive: ordered steps + terminal state)
 *       ↓
 * CalibrationRecord[]  (per-step research rows derived from the trace)
 * ```
 */

export interface TraceStateRef {
  readonly url: string;
  readonly stableKey: string | null;
  readonly sensitiveKey: string | null;
}

export interface TraceTiming {
  readonly motorTimeMs?: number;
  readonly perceivedLatencyMs?: number;
  readonly latencyEvidence?: LatencyEvidence;
}

export interface TraceStep {
  readonly index: number;
  readonly timestampMs: number;
  readonly stateBefore: TraceStateRef;
  /** Absent when the deciding branch selected without scoring. */
  readonly choiceSet?: ChoiceSet;
  readonly selectedAction: Action;
  readonly actionDescription: string;
  readonly rationale: string;
  readonly goal: string;
  readonly subgoal: string | null;
  readonly prediction: Prediction;
  readonly timing: TraceTiming;
  /**
   * Genuine post-action observation. Reconstructed as the NEXT step's
   * before-state (the session chains `after.percept` forward), or the
   * terminal state for the final action. For abandon decisions (no
   * actuation) it equals `stateBefore`. Null only when unknowable
   * (e.g. crashed runs with no observation at all).
   */
  readonly stateAfter: TraceStateRef | null;
  readonly outcome: PredictionOutcome | null;
  readonly affective: Readonly<Record<string, number>>;
  readonly provenance: Readonly<Record<string, EvidenceProvenance>>;
}

/**
 * Genuine terminal observation recorded by the session: the last
 * post-action state, the goal-satisfying percept, or the abandonment
 * percept. Screenshots are never included (buffers must not enter
 * persisted traces); element/dialog counts plus a truncated text excerpt
 * preserve observability without them.
 */
export interface TerminalObservation {
  readonly url: string;
  readonly title: string;
  readonly timestampMs: number;
  readonly step: number;
  readonly stableKey: string | null;
  readonly sensitiveKey: string | null;
  readonly elementCount: number;
  readonly dialogCount: number;
  readonly text: string | null;
}

export interface AbandonmentInfo {
  /** Ms from first step to abandonment; null when unknowable. */
  readonly timeToAbandonMs: number | null;
  readonly stepToAbandon: number;
  /** Sensitive state the operator abandoned in. */
  readonly stateKey: string | null;
  /** Free-text cause (operator's own abandon reason). No cause enum is
   * inferred — cause attribution is future research, not current data. */
  readonly cause: string | null;
  readonly lastActionKind: Action["kind"] | null;
  readonly lastSurprise: number | null;
  readonly goalAchieved: boolean;
}

export interface TerminalState {
  readonly url: string;
  readonly title: string;
  readonly timestampMs: number;
  readonly step: number;
  readonly stableKey: string | null;
  readonly sensitiveKey: string | null;
  readonly elementCount: number;
  readonly dialogCount: number;
  /**
   * Visible-text excerpt of the terminal observation (truncated). Null when
   * no terminal observation exists (e.g. crashed before first percept).
   */
  readonly text: string | null;
  readonly endReason: string;
  /** Affective snapshot at termination (last emotion timeline entry). */
  readonly affective?: Readonly<Record<string, number>>;
  /** Present only when `endReason` is abandonment (descriptive, not a model). */
  readonly abandonment?: AbandonmentInfo;
}

export interface TraceModelIdentity {
  readonly behaviorModelVersion: string;
  readonly parameterSetVersion: string;
  readonly policy: string;
  readonly implementationRevision: string | null;
}

export interface ExperienceTrace {
  readonly version: 1;
  /** Deterministic run identity (seed + persona + task + start). */
  readonly traceId: string;
  /** 1:1 with traceId today (one trace per session); kept distinct so a
   * future multi-trace session needs no schema migration. */
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly model: TraceModelIdentity;
  readonly persona: string;
  readonly personaTraits?: PersonaTraits;
  readonly seed: number | string;
  readonly startUrl: string;
  readonly goal: string;
  /** Environment identity: which surface executed the run. */
  readonly surfaceAdapter: string;
  readonly surfaceAdapterVersion: string | null;
  readonly initialState: TraceStateRef | null;
  readonly steps: readonly TraceStep[];
  /** Genuine terminal observation — never a bare URL. Null only when the
   * run produced no observation at all (explicit absence). */
  readonly terminal: TerminalState | null;
  readonly endReason: string;
  readonly goalAchieved: boolean;
  readonly abandoned: boolean;
}

/** Deterministic trace identity from the run's generating parameters. */
export function traceIdFor(opts: {
  seed: number | string;
  persona: string;
  taskId: string | null;
  startUrl: string;
}): string {
  return `eve-${seedFromString(
    [String(opts.seed), opts.persona, opts.taskId ?? "-", opts.startUrl].join("|"),
  ).toString(36)}`;
}

/** Strip a percept to a serializable snapshot (screenshot buffer removed). */
export function stripPercept(percept: Percept): PerceptSnapshot {
  const { screenshot: _dropped, ...rest } = percept;
  return { ...rest, screenshot: null };
}

function refOf(
  url: string,
  stableKey?: string | null,
  sensitiveKey?: string | null,
): TraceStateRef {
  return {
    url,
    stableKey: stableKey ?? null,
    sensitiveKey: sensitiveKey ?? null,
  };
}

/**
 * Build the canonical trace from a finished session result. Pure and
 * deterministic: same result → byte-identical trace (verified by test).
 *
 * `stateAfter` chaining: step[i].stateAfter is step[i+1].stateBefore, which
 * is genuine because the session forwards each post-action observation as
 * the next pre-action percept. The final action's after-state is the
 * terminal observation. Abandon steps (no actuation) reuse stateBefore.
 */
export function buildExperienceTrace(
  result: SessionResult,
  opts: {
    taskId?: string | null;
    behaviorModelVersion?: string;
    parameterSetVersion?: string;
    implementationRevision?: string | null;
  } = {},
): ExperienceTrace {
  const taskId = opts.taskId ?? result.taskId ?? null;
  const traceId = traceIdFor({
    seed: result.seed,
    persona: result.personaName,
    taskId,
    startUrl: result.startUrl,
  });
  const goal = result.iterations[0]?.goal ?? "";

  const steps: TraceStep[] = result.iterations.map((it, i) => {
    const next = result.iterations[i + 1];
    const isAbandon = it.action.kind === "abandon";
    const before = refOf(it.url, it.stableKey, it.sensitiveKey);
    const stateAfter: TraceStateRef | null = isAbandon
      ? before
      : next
        ? refOf(next.url, next.stableKey, next.sensitiveKey)
        : result.terminalState
          ? refOf(
              result.terminalState.url,
              result.terminalState.stableKey,
              result.terminalState.sensitiveKey,
            )
          : null;
    return {
      index: it.step,
      timestampMs: it.timestamp,
      stateBefore: before,
      ...(it.choiceSet ? { choiceSet: it.choiceSet } : {}),
      selectedAction: it.action,
      actionDescription: it.actionDescription,
      rationale: it.rationale,
      goal: it.goal,
      subgoal: it.subgoal,
      prediction: it.prediction,
      timing: {
        ...(it.outcome?.motorTimeMs !== undefined ? { motorTimeMs: it.outcome.motorTimeMs } : {}),
        ...(it.outcome ? { perceivedLatencyMs: it.outcome.perceivedLatencyMs } : {}),
        ...(it.outcome?.latencyEvidence ? { latencyEvidence: it.outcome.latencyEvidence } : {}),
      },
      stateAfter,
      outcome: it.outcome,
      affective: it.emotion,
      provenance: {
        observation: "observed",
        choice: it.choiceSet ? "derived" : "modeled",
        prediction: "derived",
        action: "observed",
        timing: it.outcome?.latencyEvidence
          ? it.outcome.latencyEvidence.deterministic
            ? "modeled"
            : "observed"
          : "modeled",
        outcome: it.outcome ? "derived" : "modeled",
        affective: "heuristic",
      } satisfies Record<string, EvidenceProvenance>,
    };
  });

  const first = result.iterations[0];
  const lastEmotion = result.emotionTimeline.at(-1)?.values ?? null;
  const terminal: TerminalState | null = result.terminalState
    ? {
        url: result.terminalState.url,
        title: result.terminalState.title,
        timestampMs: result.terminalState.timestampMs,
        step: result.terminalState.step,
        stableKey: result.terminalState.stableKey,
        sensitiveKey: result.terminalState.sensitiveKey,
        elementCount: result.terminalState.elementCount,
        dialogCount: result.terminalState.dialogCount,
        text: result.terminalState.text,
        endReason: result.endReason,
        ...(lastEmotion ? { affective: { ...lastEmotion } } : {}),
        ...(result.abandoned
          ? {
              abandonment: {
                timeToAbandonMs:
                  first != null ? result.terminalState.timestampMs - first.timestamp : null,
                stepToAbandon: result.terminalState.step,
                stateKey: result.terminalState.sensitiveKey,
                cause: result.abandonReason,
                lastActionKind:
                  result.iterations.length > 0
                    ? (result.iterations[result.iterations.length - 1]!.action
                        .kind as Action["kind"])
                    : null,
                lastSurprise:
                  result.iterations.length > 0
                    ? (result.iterations[result.iterations.length - 1]!.outcome?.surprise ?? null)
                    : null,
                goalAchieved: result.goalAchieved,
              },
            }
          : {}),
      }
    : null;

  return {
    version: 1,
    traceId,
    sessionId: traceId,
    taskId,
    model: {
      behaviorModelVersion: opts.behaviorModelVersion ?? BEHAVIOR_MODEL_VERSION,
      parameterSetVersion: opts.parameterSetVersion ?? PARAMETER_SET_VERSION,
      policy: result.policyName ?? "unknown",
      implementationRevision: opts.implementationRevision ?? implementationRevision(),
    },
    persona: result.personaName,
    ...(result.personaTraits ? { personaTraits: result.personaTraits } : {}),
    seed: result.seed,
    startUrl: result.startUrl,
    goal,
    surfaceAdapter: result.surfaceAdapter ?? "unknown",
    surfaceAdapterVersion: result.surfaceAdapterVersion ?? null,
    initialState: first ? refOf(first.url, first.stableKey, first.sensitiveKey) : null,
    steps,
    terminal,
    endReason: result.endReason,
    goalAchieved: result.goalAchieved,
    abandoned: result.abandoned,
  };
}

/** Deterministic serialization (insertion-ordered JSON). */
export function renderTraceJson(trace: ExperienceTrace): string {
  return JSON.stringify(trace, null, 2);
}

/** Append-friendly one-record-per-line export. */
export function renderTraceJsonl(trace: ExperienceTrace): string {
  return `${JSON.stringify(trace)}\n`;
}
