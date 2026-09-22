import type { PopulationDistribution } from "../population/index.js";

/**
 * Experiment manifest (Phase 14 calibration substrate).
 *
 * An experiment that can be re-run from a manifest instead of undocumented
 * CLI flags. Minimal by design: identity, tasks, environment, frozen model
 * reference, population, variants, seeds, and the dataset split contract.
 * No execution engine here — a manifest DESCRIBES an experiment; runners
 * consume it. Held-out evaluation is a split-design requirement, not an
 * optional analysis choice.
 */

export type PopulationKind = "balanced" | "distribution";

export interface ExperimentPopulation {
  readonly kind: PopulationKind;
  readonly size: number;
  readonly seed: number | string;
  readonly distribution?: PopulationDistribution;
}

export interface ExperimentVariant {
  readonly name: string;
  /** Free-form session-option overrides, e.g. `{ cognitive: true }`. */
  readonly sessionOptions?: Readonly<Record<string, unknown>>;
}

export type DatasetSplitMethod =
  | "held-out-users"
  | "held-out-tasks"
  | "held-out-interfaces"
  | "random-split";

export interface ExperimentDatasetSplit {
  readonly method: DatasetSplitMethod;
  /** Fraction reserved for held-out evaluation, 0..1 exclusive. */
  readonly heldOutFraction: number;
  readonly seed: number | string;
}

export interface ExperimentEnvironment {
  readonly adapter: string;
  readonly viewport?: { width: number; height: number };
  readonly locale?: string;
}

export interface ExperimentSpec {
  readonly experimentId: string;
  readonly taskIds: readonly string[];
  readonly environment: ExperimentEnvironment;
  readonly behaviorModelVersion: string;
  readonly parameterSetVersion: string;
  readonly population: ExperimentPopulation;
  readonly variants: readonly ExperimentVariant[];
  readonly seeds: readonly (number | string)[];
  readonly datasetSplit: ExperimentDatasetSplit;
}

/** Structural validation: returns error strings, empty when valid. */
export function validateExperimentSpec(spec: ExperimentSpec): string[] {
  const errors: string[] = [];
  if (!spec.experimentId.trim()) errors.push("experimentId must be non-empty.");
  if (spec.taskIds.length === 0) errors.push("at least one taskId is required.");
  if (spec.taskIds.some((t) => !t.trim())) errors.push("taskIds must all be non-empty.");
  if (!spec.environment.adapter.trim()) errors.push("environment.adapter must be non-empty.");
  if (!spec.behaviorModelVersion.trim()) errors.push("behaviorModelVersion must be non-empty.");
  if (!spec.parameterSetVersion.trim()) errors.push("parameterSetVersion must be non-empty.");
  if (spec.population.size < 1) errors.push("population.size must be >= 1.");
  if (!Number.isFinite(spec.population.size)) {
    errors.push("population.size must be a finite number.");
  }
  if (!Number.isInteger(spec.population.size)) {
    errors.push("population.size must be an integer (fractional sizes diverge from manifests).");
  }
  if (
    spec.population.kind === "distribution" &&
    (!spec.population.distribution || spec.population.distribution.segments.length === 0)
  ) {
    errors.push("distribution populations require a non-empty distribution.");
  }
  const weights = spec.population.distribution?.segments.map((s) => s.weight) ?? [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    errors.push("distribution weights must be finite numbers >= 0.");
  }
  if (weights.length > 0 && weights.every((w) => w === 0)) {
    errors.push("distribution weights must sum to more than 0.");
  }
  if (spec.variants.length === 0) errors.push("at least one variant is required.");
  const names = spec.variants.map((v) => v.name);
  if (names.some((n) => !n.trim())) errors.push("variant names must all be non-empty.");
  if (new Set(names).size !== names.length) errors.push("variant names must be unique.");
  if (spec.seeds.length === 0) errors.push("at least one seed is required.");
  const f = spec.datasetSplit.heldOutFraction;
  if (!(f > 0) || !(f < 1))
    errors.push("datasetSplit.heldOutFraction must be strictly between 0 and 1.");
  return errors;
}

/** Deterministic serialization for manifest freezing and review. */
export function renderExperimentJson(spec: ExperimentSpec): string {
  return JSON.stringify(spec, null, 2);
}
