/**
 * Human digital twins — persistent, named user models that evolve across
 * sessions. A twin couples a base persona (plus optional profession/culture)
 * with an accumulating history: it remembers the apps it has used, grows more
 * expert, and its confidence baseline drifts toward its lived experience.
 */

import type { ApplicationMemory } from "../memory/index.js";

export interface TwinEvolution {
  /** Sessions this twin has completed. */
  readonly sessions: number;
  /** 0–1, grows with experience (diminishing returns). */
  readonly expertise: number;
  /** Evolving confidence baseline (feeds the persona's starting confidence). */
  readonly confidenceBaseline: number;
  /** Overall experience score per session (oldest first). */
  readonly scoreHistory: readonly number[];
  /** Final trust per session (oldest first). */
  readonly trustHistory: readonly number[];
  /** Running mean of the score history. */
  readonly meanScore: number;
  /** Distinct apps (URLs) this twin has experienced. */
  readonly appsExperienced: readonly string[];
}

export interface TwinProfile {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly basePersona: string;
  readonly profession?: string;
  readonly culture?: string;
  readonly evolution: TwinEvolution;
  /** Learned per-app memory, keyed by appId (a persisted MemoryStore body). */
  readonly memories: Readonly<Record<string, ApplicationMemory>>;
}

/** The outcome of one twin session, used to evolve the twin. */
export interface TwinSessionOutcome {
  readonly url: string;
  readonly overall: number;
  readonly completed: boolean;
  readonly finalTrust: number;
  readonly steps: number;
}
