/**
 * Session timing controller (P0.1, architecture extraction step 1).
 *
 * Owns the boundary between human time and surface time:
 *
 * ```text
 * decision
 *   ↓
 * human hesitation / preparation / motor (humanMs — NEVER latency)
 *   ↓
 * ACTUATION (adapter call returns; surface wait endured)
 *   ↓
 * surface response + settle polling (surfaceMs — THIS is latency)
 *   ↓
 * settled observation
 * ```
 *
 * The pure helper below is the single place the invariant lives, so
 * regression tests can pin it without driving a browser:
 * perceived latency = settledObservationTime − actuationCompletionTime,
 * clamped at zero, with settle counted exactly once (via the clock itself —
 * `Observer.observe` already advances the clock while settling, so callers
 * must NOT add `settleMs` again).
 *
 * Reviewer decision 3 adds a second obligation: every interaction record
 * exposes WHERE its latency came from (`LatencyEvidence`), so the evaluator
 * can choose whether environmental (wall-clock) variance participates in the
 * model. Real latency is never hidden and never silently smoothed.
 */
export function computePerceivedLatency(opts: {
  /** Clock reading immediately after actuation completed (human time excluded). */
  actuationEndMs: number;
  /** Clock reading after the settled post-action observation. */
  settledObservationMs: number;
}): number {
  return Math.max(0, opts.settledObservationMs - opts.actuationEndMs);
}

/** Timing-semantics documentation anchor for reports and docs. */
export const TIMING_SEMANTICS =
  "Perceived surface latency starts at actuation completion; human decision/hesitation/motor time is excluded; settle is counted exactly once via the clock.";

/**
 * Build the latency-provenance record for one interaction.
 *
 * - Deterministic clock: the session clock IS the measurement → source
 *   "modeled". Wall time is deliberately NOT recorded (`observedMs: 0`):
 *   host noise must not enter the trajectory, or deterministic replay
 *   breaks — the very contamination this module exists to prevent
 *   (regression: tests/determinismReplay.test.ts).
 * - Wall clock: the wall interval IS what the operator experienced → source
 *   "environmental". The modeled interval is recorded alongside so analysis
 *   can separate the two.
 */
export function latencyEvidenceFor(opts: {
  modeledMs: number;
  observedMs: number;
  deterministic: boolean;
}): import("../core/types.js").LatencyEvidence {
  return {
    modeledMs: Math.max(0, opts.modeledMs),
    observedMs: opts.deterministic ? 0 : Math.max(0, opts.observedMs),
    source: opts.deterministic ? "modeled" : "environmental",
    deterministic: opts.deterministic,
  };
}
