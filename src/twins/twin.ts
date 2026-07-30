/**
 * Digital-twin lifecycle: create a twin, derive its (evolved) persona, run a
 * session that both uses and updates its memory, and evolve its profile from
 * the outcome.
 */

import type { BrowserAdapter } from "../browser/index.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import { type ApplicationMemory, InMemoryStore } from "../memory/index.js";
import { type Persona, applyProfession, getPersona, getProfession } from "../personas/index.js";
import type { TwinEvolution, TwinProfile, TwinSessionOutcome } from "./types.js";

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, p = 3): number => Math.round(v * 10 ** p) / 10 ** p;

export interface CreateTwinSpec {
  readonly id: string;
  readonly name: string;
  readonly basePersona: string;
  readonly profession?: string;
  readonly culture?: string;
}

/** Create a fresh twin, seeding its confidence baseline from the base persona. */
export function createTwin(spec: CreateTwinSpec): TwinProfile {
  const base = getPersona(spec.basePersona); // throws on unknown persona
  const now = new Date().toISOString();
  return {
    id: spec.id,
    name: spec.name,
    createdAt: now,
    updatedAt: now,
    basePersona: spec.basePersona,
    ...(spec.profession ? { profession: spec.profession } : {}),
    ...(spec.culture ? { culture: spec.culture } : {}),
    evolution: {
      sessions: 0,
      expertise: 0,
      confidenceBaseline: base.traits.baseConfidence,
      scoreHistory: [],
      trustHistory: [],
      meanScore: 0,
      appsExperienced: [],
    },
    memories: {},
  };
}

/** Derive the twin's current persona, reflecting its evolved confidence. */
export function twinPersona(twin: TwinProfile): Persona {
  let persona = getPersona(twin.basePersona);
  if (twin.profession) persona = applyProfession(persona, getProfession(twin.profession));
  const confidence = twin.evolution.confidenceBaseline;
  return {
    ...persona,
    name: twin.name,
    traits: { ...persona.traits, baseConfidence: confidence },
    disposition: { ...persona.disposition, confidence },
  };
}

/** Evolve a twin's profile from a session outcome (pure). */
export function evolveTwin(evolution: TwinEvolution, outcome: TwinSessionOutcome): TwinEvolution {
  const sessions = evolution.sessions + 1;
  const scoreHistory = [...evolution.scoreHistory, outcome.overall];
  const trustHistory = [...evolution.trustHistory, round(outcome.finalTrust)];
  const meanScore = round(scoreHistory.reduce((s, v) => s + v, 0) / scoreHistory.length, 1);
  // Confidence drifts toward lived performance (80/20 blend), nudged by outcome.
  const performance = outcome.overall / 100;
  const nudge = outcome.completed ? 0.03 : -0.05;
  const confidenceBaseline = clamp(
    evolution.confidenceBaseline * 0.8 + performance * 0.2 + nudge,
    0.1,
    0.95,
  );
  // Expertise grows with diminishing returns (power law of practice).
  const expertise = round(1 - 1 / (1 + sessions * 0.6));
  const appsExperienced = evolution.appsExperienced.includes(outcome.url)
    ? evolution.appsExperienced
    : [...evolution.appsExperienced, outcome.url];

  return {
    sessions,
    expertise,
    confidenceBaseline: round(confidenceBaseline),
    scoreHistory,
    trustHistory,
    meanScore,
    appsExperienced,
  };
}

export interface TwinSessionConfig {
  readonly adapter: BrowserAdapter;
  readonly url: string;
  readonly goal?: string;
  readonly goalSuccessSignals?: readonly string[];
  readonly seed?: number | string;
  readonly maxSteps?: number;
  readonly cognitive?: boolean;
}

export interface TwinSessionResult {
  readonly twin: TwinProfile;
  readonly result: SessionResult;
  readonly outcome: TwinSessionOutcome;
}

/**
 * Run one session as this twin: seed an in-memory store from the twin's learned
 * memories, run the session (which reads and updates that memory), then evolve
 * the twin and fold the updated memory back in. Returns the updated twin.
 */
export async function runTwinSession(
  twin: TwinProfile,
  config: TwinSessionConfig,
): Promise<TwinSessionResult> {
  const store = new InMemoryStore();
  for (const memory of Object.values(twin.memories)) await store.save(memory);

  const result = await new EveSession({
    adapter: config.adapter,
    startUrl: config.url,
    persona: twinPersona(twin),
    goal: config.goal,
    goalSuccessSignals: config.goalSuccessSignals ? [...config.goalSuccessSignals] : undefined,
    seed: config.seed,
    maxSteps: config.maxSteps ?? 60,
    cognitive: config.cognitive ?? false,
    culture: twin.culture,
    longTermMemory: store,
  }).run();

  const overall = result.scores.find((s) => s.dimension === "overall")?.value ?? 0;
  const completed = config.goal ? result.goalAchieved : !result.abandoned;
  const finalTrust = result.emotionTimeline.at(-1)?.values.trust ?? 0.5;
  const outcome: TwinSessionOutcome = {
    url: config.url,
    overall,
    completed,
    finalTrust,
    steps: result.usage.steps,
  };

  const memories: Record<string, ApplicationMemory> = {};
  for (const memory of Object.values(store.snapshot().applications))
    memories[memory.appId] = memory;

  const twinUpdated: TwinProfile = {
    ...twin,
    updatedAt: new Date().toISOString(),
    evolution: evolveTwin(twin.evolution, outcome),
    memories,
  };
  return { twin: twinUpdated, result, outcome };
}
