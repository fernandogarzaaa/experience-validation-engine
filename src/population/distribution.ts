import { createRng, seedFromString } from "../core/random.js";
import { listPersonas } from "../personas/index.js";
import type { OperatorSpec } from "./population.js";

/**
 * Population distribution sampling (Phase 10 calibration substrate).
 *
 * Two sampling semantics, explicitly distinguished:
 *
 * - `BalancedPanel` (default, unchanged): deterministic round-robin over
 *   the persona/profession/culture pools. Guarantees balanced coverage —
 *   every persona appears equally often. This is NOT a population model.
 * - `PopulationDistribution`: weighted, seeded sampling from explicit
 *   segment weights. Deterministic given (distribution, size, seed):
 *   cumulative-weight draws from a dedicated `createRng` stream derived
 *   from the base seed (never a live session RNG), so the same spec
 *   always yields the same roster.
 *
 * Weights are OPERATOR-specified scenario parameters, never demographic
 * claims: nothing here asserts these weights represent real user
 * populations until human evidence says so. Unnormalized weights are
 * normalized (with an explicit error on all-zero/negative).
 */

export interface PopulationSegment {
  readonly persona?: string;
  readonly profession?: string;
  readonly culture?: string;
  /** Relative weight; normalized across segments. Must be >= 0. */
  readonly weight: number;
}

export interface PopulationDistribution {
  readonly segments: readonly PopulationSegment[];
}

function normalizeWeights(distribution: PopulationDistribution): number[] {
  if (distribution.segments.length === 0) {
    throw new Error("PopulationDistribution needs at least one segment.");
  }
  const weights = distribution.segments.map((s) => s.weight);
  // Non-finite weights are rejected outright: Infinity/Infinity is NaN and
  // silently biases every draw to the final segment (CodeRabbit PR #46).
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error("PopulationDistribution weights must be finite numbers >= 0.");
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new Error("PopulationDistribution weights must sum to more than 0.");
  }
  return weights.map((w) => w / total);
}

/**
 * Deterministic weighted roster. Draw `size` operators by cumulative-weight
 * sampling; personas/professions/cultures default per draw (segment value,
 * else the caller's fallback pools round-robin, else library default).
 * Seeds derive as `${base}#weighted-${i}` so weighted rosters never collide
 * with round-robin `#i` seeds. Non-finite or sub-1 sizes throw — a NaN size
 * must never silently yield zero operators.
 */
export function sampleDistribution(
  distribution: PopulationDistribution,
  size: number,
  seed: number | string,
  fallbackPersonas?: readonly string[],
  fallbackProfessions?: readonly string[],
  fallbackCultures?: readonly string[],
): OperatorSpec[] {
  if (!Number.isFinite(size)) {
    throw new Error(`PopulationDistribution size must be a finite number, got ${size}.`);
  }
  const n = Math.max(1, Math.floor(size));
  const normalized = normalizeWeights(distribution);
  const cumulative: number[] = [];
  let acc = 0;
  for (const w of normalized) {
    acc += w;
    cumulative.push(acc);
  }
  const rng = createRng(typeof seed === "string" ? seedFromString(`dist:${seed}`) : seed);
  const pool =
    fallbackPersonas && fallbackPersonas.length > 0
      ? fallbackPersonas
      : listPersonas().map((p) => p.name);
  const specs: OperatorSpec[] = [];
  for (let i = 0; i < n; i += 1) {
    const roll = rng.next();
    let segIndex = cumulative.findIndex((c) => roll < c);
    if (segIndex < 0) segIndex = cumulative.length - 1;
    const seg = distribution.segments[segIndex]!;
    specs.push({
      index: i,
      persona: seg.persona ?? pool[i % pool.length]!,
      seed: `${String(seed)}#weighted-${i}`,
      profession:
        seg.profession ??
        (fallbackProfessions && fallbackProfessions.length > 0
          ? fallbackProfessions[i % fallbackProfessions.length]!
          : undefined),
      culture:
        seg.culture ??
        (fallbackCultures && fallbackCultures.length > 0
          ? fallbackCultures[i % fallbackCultures.length]!
          : undefined),
    });
  }
  return specs;
}
