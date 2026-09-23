import type { Action } from "../core/types.js";
import { type CanonicalSurfaceIdentity, canonicalMatchBasis } from "../memory/surfaceIdentity.js";
import { matchTaskIds } from "../planning/task.js";
import type { HumanIterationReference } from "./record.js";

/**
 * Deterministic trajectory alignment (Phase 8 calibration substrate).
 *
 * Answers `human step X ↔ EVE step Y` WITHOUT fuzzy matching: greedy,
 * NON-CROSSING, earliest-match-wins. Step numbers alone are never
 * trusted — alignment proceeds through an explicit evidence ladder:
 *
 * 1. task + stable state (strongest structural match)
 * 2. task + sensitive state
 * 3. task + action semantics (kind, then label)
 * 4. order proximity (weakest — only when nothing else matches)
 *
 * Monotonicity is enforced: once human step X pairs with EVE step Y, no
 * later human step may pair with an EVE step at or before Y. Crossing
 * matches are refused even when states are identical — backtracking
 * surfaces as unmatched + re-matched-forward, never as time travel.
 * Task-conflicting pairs are refused at every level: steps from different
 * tasks are different experiments, full stop.
 *
 * LIMITATIONS (documented, not hidden): greedy matching can misalign
 * repeated identical states; order proximity is a fallback, not evidence
 * of correspondence; action labels are compared case-insensitively as
 * substrings, which is crude for paraphrased human actions. This layer
 * exists to make pilot alignment COMPUTABLE, not to claim it is correct —
 * every pair carries its `basis` so downstream analysis can filter by
 * match strength (e.g. keep only task+state matches for fitting).
 */

export interface HumanStep {
  readonly index: number;
  readonly taskId?: string;
  readonly state?: CanonicalSurfaceIdentity;
  readonly url?: string;
  readonly actionKind?: Action["kind"] | string;
  readonly actionLabel?: string;
  /** Interaction target (control label, field name, URL). Redactable. */
  readonly target?: string;
  readonly timestampMs?: number;
  readonly durationMs?: number;
  readonly transitionTo?: string;
  readonly outcome?: string;
  readonly correction?: string;
  readonly recovery?: HumanIterationReference["recovery"];
  readonly abandoned?: boolean;
  readonly selfReport?: Readonly<Record<string, number>>;
}

export interface EveAlignStep {
  readonly index: number;
  readonly taskId?: string | null;
  readonly stableKey?: string | null;
  readonly sensitiveKey?: string | null;
  readonly url: string;
  readonly actionKind: Action["kind"];
  readonly actionLabel: string;
}

export type AlignmentBasis =
  | "task+stable"
  | "task+sensitive"
  | "task+external-id"
  | "task+url"
  | "stable"
  | "sensitive"
  | "external-id"
  | "url"
  | "action-kind"
  | "action-label"
  | "order";

export interface AlignedPair {
  readonly humanIndex: number;
  readonly eveIndex: number;
  readonly basis: AlignmentBasis;
}

export interface TraceAlignment {
  readonly pairs: readonly AlignedPair[];
  /** Human steps with no EVE counterpart (extra/confounding behavior). */
  readonly unmatchedHuman: readonly number[];
  /** EVE steps with no human counterpart (model-only exploration). */
  readonly unmatchedEve: readonly number[];
  /** Descriptive coverage fractions — NOT scores, NOT validity claims. */
  readonly coverage: {
    readonly humanMatched: number;
    readonly humanTotal: number;
    readonly eveMatched: number;
    readonly eveTotal: number;
  };
  readonly method: string;
  readonly limitations: readonly string[];
}

function eveCanonical(e: EveAlignStep, taskId?: string | null): CanonicalSurfaceIdentity {
  return {
    kind: e.sensitiveKey ? "eve-sensitive" : "eve-stable",
    taskId: taskId ?? e.taskId ?? null,
    url: e.url,
    ...(e.stableKey ? { eveStableKey: e.stableKey } : {}),
    ...(e.sensitiveKey ? { eveSensitiveKey: e.sensitiveKey } : {}),
    provenance: "eve-perception",
  };
}

function humanCanonical(h: HumanStep, taskId?: string | null): CanonicalSurfaceIdentity {
  return {
    kind: "human",
    // Nested state task IDs are honored: a step carrying its task inside
    // `state` must not lose it when no top-level id is present.
    taskId: taskId ?? h.taskId ?? h.state?.taskId ?? null,
    url: h.url ?? h.state?.url ?? null,
    ...(h.state?.eveStableKey ? { eveStableKey: h.state.eveStableKey } : {}),
    ...(h.state?.eveSensitiveKey ? { eveSensitiveKey: h.state.eveSensitiveKey } : {}),
    ...(h.state?.externalStateId ? { externalStateId: h.state.externalStateId } : {}),
    provenance: "human-report",
  };
}

function labelsMatch(humanLabel: string | undefined, eveLabel: string): boolean {
  if (!humanLabel) return false;
  const h = humanLabel.trim().toLowerCase();
  const e = eveLabel.trim().toLowerCase();
  return h.length > 0 && (e.includes(h) || h.includes(e));
}

/**
 * Align human steps to EVE steps. Deterministic: same inputs →
 * byte-identical alignment. Greedy earliest-match, strictly monotone
 * (non-crossing); each step used at most once on either side. Steps from
 * conflicting tasks never pair at any level.
 */
export function alignTraces(
  human: readonly HumanStep[],
  eve: readonly EveAlignStep[],
  opts: { taskId?: string | null } = {},
): TraceAlignment {
  const usedEve = new Set<number>();
  let floor = -1;
  const pairs: AlignedPair[] = [];
  const unmatchedHuman: number[] = [];

  /** True when both sides name a task and the names disagree. */
  const taskConflicts = (humanTask: string | null, e: EveAlignStep): boolean => {
    const eveTask = opts.taskId ?? e.taskId ?? null;
    return (
      humanTask != null &&
      humanTask.trim() !== "" &&
      eveTask != null &&
      eveTask.trim() !== "" &&
      !matchTaskIds(humanTask, eveTask)
    );
  };

  for (const h of human) {
    const hc = humanCanonical(h, opts.taskId);
    let match: { index: number; basis: AlignmentBasis } | null = null;

    // Pass 1: state identity (strongest first). Canonical matching already
    // refuses task disagreement, so any basis here is task-compatible.
    for (const e of eve) {
      if (e.index <= floor || usedEve.has(e.index)) continue;
      const basis = canonicalMatchBasis(hc, eveCanonical(e, opts.taskId));
      if (
        basis === "task+stable" ||
        basis === "task+sensitive" ||
        basis === "task+external-id" ||
        basis === "stable" ||
        basis === "sensitive" ||
        basis === "external-id"
      ) {
        match = { index: e.index, basis };
        break;
      }
    }
    // Pass 2: action semantics — skipped entirely on task conflict.
    if (!match) {
      for (const e of eve) {
        if (e.index <= floor || usedEve.has(e.index)) continue;
        if (taskConflicts(hc.taskId, e)) continue;
        if (h.actionKind && h.actionKind === e.actionKind) {
          match = { index: e.index, basis: "action-kind" };
          break;
        }
      }
    }
    if (!match) {
      for (const e of eve) {
        if (e.index <= floor || usedEve.has(e.index)) continue;
        if (taskConflicts(hc.taskId, e)) continue;
        if (labelsMatch(h.actionLabel, e.actionLabel)) {
          match = { index: e.index, basis: "action-label" };
          break;
        }
      }
    }
    // Pass 3: order proximity fallback (weak — flagged by basis).
    // Also task-gated: positional pairing across experiments is meaningless.
    if (!match) {
      const fallback = eve.find(
        (e) => e.index > floor && !usedEve.has(e.index) && !taskConflicts(hc.taskId, e),
      );
      if (fallback) match = { index: fallback.index, basis: "order" };
    }

    if (match) {
      usedEve.add(match.index);
      floor = match.index;
      pairs.push({ humanIndex: h.index, eveIndex: match.index, basis: match.basis });
    } else {
      unmatchedHuman.push(h.index);
    }
  }

  const unmatchedEve = eve.map((e) => e.index).filter((i) => !usedEve.has(i));
  return {
    pairs,
    unmatchedHuman,
    unmatchedEve,
    coverage: {
      humanMatched: pairs.length,
      humanTotal: human.length,
      eveMatched: pairs.length,
      eveTotal: eve.length,
    },
    method:
      "greedy earliest-match, strictly monotone: task+state identity → action semantics → order fallback",
    limitations: [
      "Greedy matching can misalign repeated identical states.",
      "Order-proximity pairs are positional fallback, not correspondence evidence.",
      "Action-label matching is case-insensitive substring — crude for paraphrase.",
      "No fuzzy/embedding similarity is attempted in this pass by design.",
    ],
  };
}

/**
 * Validate + normalize a raw human-study object carrying optional per-step
 * detail into `HumanStep[]`. All step fields optional: a pilot dataset may
 * carry only actions, a full dataset adds targets, durations, corrections,
 * recovery, and self-reports. Unknown fields are ignored, never trusted.
 */
export function importHumanSteps(raw: unknown): HumanStep[] {
  if (!Array.isArray(raw)) throw new Error("Human steps must be an array.");
  return raw.map((t, i) => {
    if (typeof t !== "object" || t === null) throw new Error(`Human step ${i} must be an object.`);
    const tr = t as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    const num = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) ? v : undefined;
    const recovery =
      typeof tr.recovery === "object" && tr.recovery !== null
        ? (tr.recovery as HumanStep["recovery"])
        : undefined;
    const state =
      typeof tr.state === "object" && tr.state !== null
        ? parseCanonicalState(tr.state as Record<string, unknown>)
        : undefined;
    const selfReport =
      typeof tr.selfReport === "object" && tr.selfReport !== null
        ? parseSelfReport(tr.selfReport as Record<string, unknown>)
        : undefined;
    return {
      index: typeof tr.index === "number" ? tr.index : i,
      ...(str(tr.taskId) ? { taskId: str(tr.taskId)! } : {}),
      ...(str(tr.url) ? { url: str(tr.url)! } : {}),
      ...(str(tr.actionKind) ? { actionKind: str(tr.actionKind)! } : {}),
      ...(str(tr.actionLabel) ? { actionLabel: str(tr.actionLabel)! } : {}),
      ...(str(tr.target) ? { target: str(tr.target)! } : {}),
      ...(num(tr.timestampMs) !== undefined ? { timestampMs: num(tr.timestampMs)! } : {}),
      ...(num(tr.durationMs) !== undefined ? { durationMs: num(tr.durationMs)! } : {}),
      ...(str(tr.transitionTo) ? { transitionTo: str(tr.transitionTo)! } : {}),
      ...(str(tr.outcome) ? { outcome: str(tr.outcome)! } : {}),
      ...(str(tr.correction) ? { correction: str(tr.correction)! } : {}),
      ...(recovery ? { recovery } : {}),
      ...(state ? { state } : {}),
      ...(selfReport ? { selfReport } : {}),
      ...(typeof tr.abandoned === "boolean" ? { abandoned: tr.abandoned } : {}),
    };
  });
}

/**
 * Validate a nested canonical state reference. Only known primitive
 * fields are admitted; unknown or mistyped fields are dropped, never
 * trusted. `kind` defaults to "human" — a human log is the expected
 * source here.
 */
function parseCanonicalState(raw: Record<string, unknown>): CanonicalSurfaceIdentity | undefined {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const kind = str(raw.kind);
  const out: CanonicalSurfaceIdentity = {
    kind: kind === "eve-stable" || kind === "eve-sensitive" || kind === "agent" ? kind : "human",
    taskId: str(raw.taskId) ?? null,
    url: str(raw.url) ?? null,
    ...(str(raw.eveStableKey) ? { eveStableKey: str(raw.eveStableKey)! } : {}),
    ...(str(raw.eveSensitiveKey) ? { eveSensitiveKey: str(raw.eveSensitiveKey)! } : {}),
    ...(str(raw.externalStateId) ? { externalStateId: str(raw.externalStateId)! } : {}),
    provenance: "human-report",
  };
  return out;
}

/** Validate a self-report map: finite numeric values only. */
function parseSelfReport(raw: Record<string, unknown>): Record<string, number> | undefined {
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, number] =>
      typeof entry[0] === "string" && typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
