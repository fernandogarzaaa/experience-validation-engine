import type {
  Action,
  Finding,
  LoopIteration,
  Percept,
  Prediction,
  PredictionOutcome,
} from "./types.js";

/**
 * Typed event map for the engine. Plugins, reporters and embedders subscribe
 * to these events; the engine itself never depends on subscribers.
 */
export interface EveEventMap {
  "session:start": { url: string; personaName: string; seed: number };
  "session:end": { reason: string; steps: number; durationMs: number };
  "loop:perceive": { percept: Percept; step: number };
  "loop:decide": {
    step: number;
    action: Action;
    rationale: string;
    prediction: Prediction;
  };
  "loop:act": { step: number; action: Action };
  "loop:outcome": { step: number; outcome: PredictionOutcome };
  "loop:iteration": { iteration: LoopIteration };
  finding: { finding: Finding };
  "goal:changed": { goal: string; subgoal: string | null };
  "emotion:update": { emotion: Readonly<Record<string, number>>; step: number };
  /** An LLM-backed policy or plugin degraded to its non-LLM fallback. */
  "llm:fallback": { source: "cognition" | "plugin"; reason: string };
}

export type EveEventName = keyof EveEventMap;

type Listener<K extends EveEventName> = (payload: EveEventMap[K]) => void | Promise<void>;

/**
 * Minimal async-aware typed event bus. Listener errors are collected and
 * surfaced via the onError hook instead of breaking the simulation loop.
 */
export class EventBus {
  private readonly listeners = new Map<EveEventName, Set<Listener<EveEventName>>>();

  constructor(private readonly onError: (err: unknown, event: string) => void = () => {}) {}

  on<K extends EveEventName>(event: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<EveEventName>);
    return () => set!.delete(listener as Listener<EveEventName>);
  }

  async emit<K extends EveEventName>(event: K, payload: EveEventMap[K]): Promise<void> {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        await listener(payload);
      } catch (err) {
        this.onError(err, event);
      }
    }
  }
}
