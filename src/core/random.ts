/**
 * Deterministic pseudo-random number generation.
 *
 * Human behavior is variable but a simulation must be reproducible: given the
 * same seed, persona and application state, EVE takes the same path. All
 * stochastic behavior (click slips, hesitation, wandering attention) draws
 * from a session-scoped {@link Rng} rather than Math.random.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Approximately normal sample (mean, stdDev) via central limit sum. */
  gaussian(mean: number, stdDev: number): number;
  /** Pick a uniformly random element; throws on empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; weights need not sum to 1. Throws on empty input. */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T;
}

/** mulberry32 — small, fast, good-enough statistical quality for simulation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    gaussian: (mean, stdDev) => {
      // Sum of 6 uniforms has stdDev sqrt(6/12); rescale to unit normal-ish.
      let sum = 0;
      for (let i = 0; i < 6; i++) sum += next();
      const unit = (sum - 3) / Math.sqrt(0.5);
      return mean + unit * stdDev;
    },
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() on empty array");
      return items[Math.floor(next() * items.length)]!;
    },
    weightedPick: (items, weights) => {
      if (items.length === 0 || items.length !== weights.length) {
        throw new Error("weightedPick() requires equal non-empty arrays");
      }
      let total = 0;
      for (const w of weights) total += Math.max(0, w);
      if (total <= 0) return items[Math.floor(next() * items.length)]!;
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= Math.max(0, weights[i]!);
        if (roll <= 0) return items[i]!;
      }
      return items[items.length - 1]!;
    },
  };
}

/** Derive a numeric seed from an arbitrary string (FNV-1a). */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Clamp helper used across the emotional/cognitive models. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
