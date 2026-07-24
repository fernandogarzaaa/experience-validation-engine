/**
 * Types for the human validation engine — importing anonymized human usability
 * traces and scoring how closely EVE's simulated population matches them.
 */

/** One anonymized human session. Only `completed` and `path` are required. */
export interface HumanTrace {
  readonly completed: boolean;
  /** Defaults to `!completed`. */
  readonly abandoned?: boolean;
  /** Ordered screen identifiers the human visited. */
  readonly path: readonly string[];
  /** Interaction count; defaults to `path.length`. */
  readonly steps?: number;
  readonly durationMs?: number;
  /** Self-reported final frustration (0..1), if collected. */
  readonly frustration?: number;
  /** Self-reported final confidence (0..1), if collected. */
  readonly confidence?: number;
  /** Screen the human abandoned on; defaults to the last in `path`. */
  readonly abandonedOn?: string;
}

export interface HumanStudy {
  readonly task?: string;
  readonly traces: readonly HumanTrace[];
}

export interface CalibrationReport {
  readonly task: string | null;
  readonly humanSampleSize: number;
  readonly eveSampleSize: number;
  /** How closely completion/abandonment rates match (0..1). */
  readonly behaviorSimilarity: number;
  /** Cosine similarity of transition-frequency vectors (0..1). */
  readonly navigationSimilarity: number;
  /** How closely steps/duration match (0..1). */
  readonly timingSimilarity: number;
  /** Pearson correlation of per-screen friction (−1..1); null if unknowable. */
  readonly frictionCorrelation: number | null;
  /** Closeness of aggregate frustration (0..1); null if humans didn't report it. */
  readonly frustrationAlignment: number | null;
  /** Closeness of aggregate confidence (0..1); null if humans didn't report it. */
  readonly confidenceAlignment: number | null;
  /** Composite realism score, 0..100. */
  readonly similarityScore: number;
  readonly notes: readonly string[];
  readonly generatedAt: string;
}
