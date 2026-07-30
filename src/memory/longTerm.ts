import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LearnedFact, ScreenEdge, ScreenNode } from "./memory.js";

/**
 * Long-term, cross-session memory.
 *
 * Humans remember applications between visits: layouts, where buttons live,
 * past mistakes, workflows that worked, and how they felt. This store
 * persists that knowledge keyed by application identity, and applies
 * between-session forgetting (Ebbinghaus decay, ACT-R rational analysis:
 * a trace's availability reflects how recently/often it was used).
 *
 * The store is a plain JSON document so it is portable, inspectable and
 * diffable; a session loads the relevant application profile at start and
 * writes an updated profile at end. This is what makes a second session
 * meaningfully differ from the first.
 */

export interface RememberedScreen {
  signature: string;
  url: string;
  title: string;
  /** Interactive labels observed here, with recall strength 0..1. */
  affordances: Record<string, number>;
  /** Times this screen has been visited across all sessions. */
  totalVisits: number;
  lastSeenSession: number;
}

export interface RememberedTransition {
  from: string;
  to: string;
  via: string;
  traversals: number;
}

export interface SessionMemoryRecord {
  session: number;
  timestamp: string;
  persona: string;
  goal: string;
  steps: number;
  durationMs: number;
  goalAchieved: boolean;
  abandoned: boolean;
  /** Mean confidence over the session. */
  confidence: number;
  /** Peak frustration over the session. */
  frustration: number;
  /** Peak/mean trust. */
  trust: number;
  /** Errors perceived. */
  errors: number;
  /** Expectation-violation rate 0..1. */
  surpriseRate: number;
  overallScore: number;
}

export interface ApplicationMemory {
  /** Stable identity of the application (usually the origin). */
  appId: string;
  appName: string;
  sessionsCount: number;
  screens: Record<string, RememberedScreen>;
  transitions: Record<string, RememberedTransition>;
  /** Semantic facts (shortcuts, conventions, warnings, feature locations). */
  facts: Record<string, LearnedFact & { lastSeenSession: number }>;
  /** Workflows the operator completed, most-used first. */
  favoriteWorkflows: Array<{ kind: string; completions: number; lastSession: number }>;
  /** Screens that repeatedly frustrated the operator. */
  frustrationSpots: Array<{ signature: string; title: string; occurrences: number }>;
  /** Shortcuts discovered to work here. */
  knownShortcuts: string[];
  /** Per-session history for learning-curve analysis. */
  history: SessionMemoryRecord[];
}

export interface MemoryStore {
  version: 2;
  applications: Record<string, ApplicationMemory>;
}

const EMPTY_STORE: MemoryStore = { version: 2, applications: {} };

/** Derive a stable application id from a URL (origin, or full mock id). */
export function appIdForUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url.split("/").slice(0, 3).join("/") || url;
  }
}

/**
 * A persistent memory store backed by a JSON file. Use {@link InMemoryStore}
 * for tests, or {@link FileMemoryStore} for real cross-session persistence.
 */
export interface PersistentMemory {
  load(appId: string): Promise<ApplicationMemory | null>;
  save(memory: ApplicationMemory): Promise<void>;
}

export class InMemoryStore implements PersistentMemory {
  private store: MemoryStore = { version: 2, applications: {} };

  async load(appId: string): Promise<ApplicationMemory | null> {
    return this.store.applications[appId] ?? null;
  }

  async save(memory: ApplicationMemory): Promise<void> {
    this.store.applications[memory.appId] = memory;
  }

  snapshot(): MemoryStore {
    return structuredClone(this.store);
  }
}

export class FileMemoryStore implements PersistentMemory {
  constructor(private readonly path: string) {}

  private async read(): Promise<MemoryStore> {
    try {
      const text = await readFile(this.path, "utf8");
      const parsed = JSON.parse(text) as MemoryStore;
      if (parsed.version !== 2 || typeof parsed.applications !== "object")
        return { ...EMPTY_STORE };
      return parsed;
    } catch {
      return { ...EMPTY_STORE };
    }
  }

  async load(appId: string): Promise<ApplicationMemory | null> {
    const store = await this.read();
    return store.applications[appId] ?? null;
  }

  async save(memory: ApplicationMemory): Promise<void> {
    const store = await this.read();
    store.applications[memory.appId] = memory;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(store, null, 2), "utf8");
  }
}

/** Create a blank application memory. */
export function emptyApplicationMemory(appId: string, appName: string): ApplicationMemory {
  return {
    appId,
    appName,
    sessionsCount: 0,
    screens: {},
    transitions: {},
    facts: {},
    favoriteWorkflows: [],
    frustrationSpots: [],
    knownShortcuts: [],
    history: [],
  };
}

/**
 * Apply between-session forgetting to a loaded memory. `sessionsElapsed` is
 * how many of the operator's sessions (anywhere) have passed since a trace
 * was last reinforced; retention 0..1 slows decay.
 *
 * Uses R = e^(−λ·Δ) with λ shrinking as retention grows — the Ebbinghaus
 * forgetting curve with rehearsal (Anderson & Schooler's rational-analysis
 * base-level activation is the same exponential family).
 */
export function applyForgetting(
  memory: ApplicationMemory,
  currentSession: number,
  retention: number,
): void {
  const lambda = 0.5 * (1 - retention * 0.8); // higher retention → flatter curve
  const decay = (lastSession: number): number => {
    const delta = Math.max(0, currentSession - lastSession);
    return Math.exp(-lambda * delta);
  };

  for (const screen of Object.values(memory.screens)) {
    const factor = decay(screen.lastSeenSession);
    for (const label of Object.keys(screen.affordances)) {
      const strength = (screen.affordances[label] ?? 0) * factor;
      if (strength < 0.08) delete screen.affordances[label];
      else screen.affordances[label] = strength;
    }
  }
  for (const key of Object.keys(memory.facts)) {
    const fact = memory.facts[key]!;
    fact.confidence *= decay(fact.lastSeenSession);
    if (fact.confidence < 0.1) delete memory.facts[key];
  }
}

/** Total recallable knowledge, for the Retention metric. */
export function retainedKnowledge(memory: ApplicationMemory): number {
  let sum = 0;
  for (const screen of Object.values(memory.screens)) {
    for (const strength of Object.values(screen.affordances)) sum += strength;
  }
  for (const fact of Object.values(memory.facts)) sum += fact.confidence;
  return sum;
}

export type { LearnedFact, ScreenNode, ScreenEdge };
