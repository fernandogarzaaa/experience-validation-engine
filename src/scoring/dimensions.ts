/**
 * The score-dimension registry.
 *
 * The sixteen dimensions that were the `ScoreDimension` closed union are
 * pre-registered as built-ins with their serialized ids unchanged, so scores,
 * reports and stored baselines are unaffected. Domain packs and plugins
 * register new dimensions here (see `EvePlugin.onRegister`) instead of
 * editing `src/core/types.ts`.
 *
 * `weight` publishes each built-in's share of the `overall` composite (the
 * scorer remains the single source of truth in Phase 0 — registering a
 * dimension can never silently reweight existing scores), and `appliesTo`
 * declares the modalities a dimension is meaningful on. No Phase-0 consumer
 * gates on `appliesTo`, so behavior is unchanged; it exists so the honesty
 * layer can treat inapplicable dimensions as *skipped, not failed* once
 * non-visual surfaces land scoring consumers.
 */

import {
  ALL_MODALITIES,
  EveRegistry,
  type Modality,
  type ScoreDimensionEntry,
} from "../core/registry.js";
import { SCORE_DIMENSIONS } from "../core/types.js";

const VISUAL_ONLY: readonly Modality[] = ["visual"];

const BUILT_INS: readonly ScoreDimensionEntry[] = [
  {
    id: "overall",
    builtin: true,
    weight: 0,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
    description: "Weighted composite of the other dimensions, capped by critical findings.",
  },
  {
    id: "usability",
    builtin: true,
    weight: 0.2,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "learnability",
    builtin: true,
    weight: 0.1,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "accessibility",
    builtin: true,
    weight: 0.1,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "efficiency",
    builtin: true,
    weight: 0.1,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "consistency",
    builtin: true,
    weight: 0,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  // Derived purely from pixel-geometry findings; vacuous where none exist.
  {
    id: "visualDesign",
    builtin: true,
    weight: 0.07,
    appliesTo: VISUAL_ONLY,
    evidenceRequired: true,
  },
  {
    id: "navigation",
    builtin: true,
    weight: 0.08,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "workflowQuality",
    builtin: true,
    weight: 0.1,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "informationArchitecture",
    builtin: true,
    weight: 0,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "onboarding",
    builtin: true,
    weight: 0,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "errorRecovery",
    builtin: true,
    weight: 0.08,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "responsiveness",
    builtin: true,
    weight: 0.07,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "userConfidence",
    builtin: true,
    weight: 0.05,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  {
    id: "cognitiveLoad",
    builtin: true,
    weight: 0,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  { id: "trust", builtin: true, weight: 0.05, appliesTo: ALL_MODALITIES, evidenceRequired: true },
];

export const dimensionRegistry = new EveRegistry<ScoreDimensionEntry>("score dimension");
for (const entry of BUILT_INS) dimensionRegistry.register(entry);

// Guard: the registry must seed exactly the type-level built-in set.
for (const id of SCORE_DIMENSIONS) {
  if (!dimensionRegistry.has(id)) {
    throw new Error(`dimension registry is out of sync with SCORE_DIMENSIONS ("${id}")`);
  }
}

/**
 * Register a new score dimension (domain packs; plugins via `onRegister`).
 *
 * `weight` defaults to 0 — a new dimension is reported but never changes
 * the composite of an existing deployment unless it explicitly asks to.
 */
export function registerDimension(
  entry: Omit<ScoreDimensionEntry, "builtin" | "evidenceRequired" | "weight" | "appliesTo"> &
    Partial<Pick<ScoreDimensionEntry, "weight" | "appliesTo">>,
): void {
  dimensionRegistry.register({
    ...entry,
    weight: entry.weight ?? 0,
    appliesTo: entry.appliesTo ?? ALL_MODALITIES,
    builtin: false,
    evidenceRequired: true,
  });
}

/** Dimensions meaningful on the given modality (`appliesTo` gating). */
export function dimensionsFor(modality: Modality): readonly ScoreDimensionEntry[] {
  return dimensionRegistry.listFor(modality);
}
