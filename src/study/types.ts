/**
 * Types for the AI-moderated user study — a panel of specialist "researcher"
 * agents that each analyze a population study from their own professional lens,
 * plus the moderator synthesis that reconciles them.
 */

export type Severity = "critical" | "major" | "minor" | "info";

/** A specialist's release stance, derived from the worst thing they saw. */
export type Stance = "block" | "caution" | "ship";

export interface StudyObservation {
  readonly statement: string;
  readonly evidence: string;
  readonly severity: Severity;
}

export interface Recommendation {
  readonly action: string;
  readonly rationale: string;
  /** 0–100; higher is more urgent. */
  readonly priority: number;
}

/** One specialist's independent report. */
export interface SpecialistReport {
  readonly role: string;
  readonly summary: string;
  /** 0–1: how strongly the data supports this specialist's read. */
  readonly confidence: number;
  readonly stance: Stance;
  readonly observations: readonly StudyObservation[];
  readonly recommendations: readonly Recommendation[];
}

export interface ConsensusPoint {
  readonly theme: string;
  readonly statement: string;
  /** Roles that independently raised this theme. */
  readonly roles: readonly string[];
  readonly severity: Severity;
}

export interface Conflict {
  readonly topic: string;
  readonly positions: readonly { readonly role: string; readonly stance: Stance }[];
  readonly note: string;
}

export interface PriorityItem {
  readonly action: string;
  readonly score: number;
  /** Which specialists called for this. */
  readonly sources: readonly string[];
  readonly rationale: string;
}

export type Verdict = "ship" | "ship-with-fixes" | "do-not-ship";

/** The moderator's synthesized executive report over the whole panel. */
export interface ExecutiveStudyReport {
  readonly verdict: Verdict;
  readonly headline: string;
  /** 0–1 aggregate confidence across the panel and the sample size. */
  readonly confidence: number;
  readonly successRate: number;
  readonly dropoffRate: number;
  readonly consensus: readonly ConsensusPoint[];
  readonly conflicts: readonly Conflict[];
  readonly priorities: readonly PriorityItem[];
  readonly specialists: readonly SpecialistReport[];
  readonly generatedAt: string;
}
