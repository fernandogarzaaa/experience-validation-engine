import type { Percept } from "../core/types.js";
import { visualOnlyText } from "../observation/provenance.js";

/**
 * Goal-evidence model (P0.4).
 *
 * Text matching is a proxy, not task completion. This module keeps the
 * backwards-compatible `successSignals: string[]` behavior (substring match)
 * but wraps every success claim in a `GoalEvidence` record that says HOW the
 * claim was established and how strong that evidence is.
 *
 * Strength ladder (weakest → strongest):
 * - "text-proxy": signal words appear in visible text (heuristic).
 * - "visual-confirmation": signal appears in *rendered* text, not in an
 *   accessibility fallback or an unactivated control label.
 * - "state-transition": the screen identity changed after an action AND the
 *   signal is present (arrival + wording, not wording alone).
 * - "destination-state": the URL/state matches a declared terminal state.
 * - "workflow-terminal": a workflow detector independently reports terminality.
 */

export type GoalEvidenceKind =
  | "text-proxy"
  | "visual-confirmation"
  | "state-transition"
  | "destination-state"
  | "workflow-terminal";

export type GoalEvidenceStrength = "weak" | "moderate" | "strong";

export interface GoalEvidence {
  readonly kind: GoalEvidenceKind;
  readonly strength: GoalEvidenceStrength;
  /** Human-readable account of what was observed. */
  readonly detail: string;
  /** True when the claim rests on text alone with no causal evidence. */
  readonly textOnly: boolean;
}

export interface GoalAssessment {
  readonly achieved: boolean;
  readonly evidence: readonly GoalEvidence[];
  /** Advisory warnings (label-only match, start-screen text, etc.). */
  readonly warnings: readonly string[];
}

const STRONG: Record<GoalEvidenceKind, GoalEvidenceStrength> = {
  "text-proxy": "weak",
  "visual-confirmation": "moderate",
  "state-transition": "strong",
  "destination-state": "strong",
  "workflow-terminal": "strong",
};

function evidence(kind: GoalEvidenceKind, detail: string, textOnly: boolean): GoalEvidence {
  return { kind, strength: STRONG[kind], detail, textOnly };
}

export function matchSignal(haystack: string, signal: string): boolean {
  const lower = signal.toLowerCase();
  const escaped = lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(lower) ? "\\b" : "";
  const right = /\w$/.test(lower) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`).test(haystack);
}

/**
 * Assess goal completion with evidence grading.
 *
 * `visibleHaystack` is the full visible-text match surface (backwards
 * compatible: includes accessibility fallbacks). `renderedHaystack` is the
 * visual-only text. When the signal matches only the former, the claim is
 * graded "text-proxy" with a warning instead of silently masquerading as
 * causal completion.
 */
export function assessGoal(opts: {
  signals: readonly string[];
  visibleHaystack: string;
  renderedHaystack?: string;
  screenChangedSinceAction?: boolean;
  atDestinationState?: boolean;
  workflowTerminal?: boolean;
  url?: string;
}): GoalAssessment {
  const warnings: string[] = [];
  const { signals } = opts;
  if (signals.length === 0) return { achieved: false, evidence: [], warnings };

  const visible = opts.visibleHaystack.toLowerCase();
  const rendered = (opts.renderedHaystack ?? opts.visibleHaystack).toLowerCase();
  const allVisible = signals.every((s) => matchSignal(visible, s));
  if (!allVisible) return { achieved: false, evidence: [], warnings };

  const allRendered = signals.every((s) => matchSignal(rendered, s));
  const ev: GoalEvidence[] = [];
  if (opts.workflowTerminal) {
    ev.push(
      evidence(
        "workflow-terminal",
        `workflow detector reports terminal state for [${signals.join(", ")}]`,
        false,
      ),
    );
  }
  if (opts.atDestinationState) {
    ev.push(
      evidence(
        "destination-state",
        `at declared destination state ${opts.url ?? ""} with [${signals.join(", ")}] present`,
        false,
      ),
    );
  }
  if (opts.screenChangedSinceAction) {
    ev.push(
      evidence(
        "state-transition",
        `screen identity changed after action and [${signals.join(", ")}] present`,
        false,
      ),
    );
  }
  if (allRendered) {
    ev.push(
      evidence(
        "visual-confirmation",
        `[${signals.join(", ")}] present in rendered (sighted-visible) text`,
        true,
      ),
    );
  } else {
    warnings.push(
      `success signal(s) [${signals.join(", ")}] matched DOM/accessibility-derived text but NOT rendered visible text — weak text-proxy evidence only.`,
    );
    ev.push(
      evidence(
        "text-proxy",
        `[${signals.join(", ")}] matched text-proxy surface only (accessibility fallback or control label)`,
        true,
      ),
    );
  }
  return { achieved: true, evidence: ev, warnings };
}

/** Convenience: grade a percept pair without threading strings manually. */
export function assessGoalOnPercepts(opts: {
  signals: readonly string[];
  visibleText: string;
  percept: Percept;
  screenChangedSinceAction?: boolean;
  atDestinationState?: boolean;
  workflowTerminal?: boolean;
  url?: string;
}): GoalAssessment {
  return assessGoal({
    signals: opts.signals,
    visibleHaystack: opts.visibleText,
    renderedHaystack: visualOnlyText(opts.percept),
    screenChangedSinceAction: opts.screenChangedSinceAction,
    atDestinationState: opts.atDestinationState,
    workflowTerminal: opts.workflowTerminal,
    url: opts.url ?? opts.percept.url,
  });
}
