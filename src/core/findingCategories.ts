/**
 * The finding-category registry.
 *
 * The ten categories that were the `FindingCategory` closed union are
 * pre-registered as built-ins with their serialized ids unchanged, so every
 * existing finding, report and consumer behaves exactly as before. Domain
 * packs and plugins register new categories here (see
 * `EvePlugin.onRegister`) instead of editing `src/core/types.ts`.
 *
 * `appliesTo` is metadata for the honesty layer: no Phase-0 consumer gates
 * on it, so behavior is unchanged; it exists so future reporting/scoring
 * can suppress inapplicable categories as *skipped, not failed*.
 */

import { ALL_MODALITIES, EveRegistry, type FindingCategoryEntry } from "./registry.js";
import { FINDING_CATEGORIES } from "./types.js";

const VISUAL_ONLY = ["visual"] as const;

const BUILT_INS: readonly FindingCategoryEntry[] = [
  { id: "usability", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  { id: "navigation", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  // Pixel-geometry findings are only meaningful where pixel geometry exists.
  { id: "visual", builtin: true, appliesTo: VISUAL_ONLY, evidenceRequired: true },
  { id: "accessibility", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  { id: "performance", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  { id: "content", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  { id: "error-recovery", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  {
    id: "expectation-violation",
    builtin: true,
    appliesTo: ALL_MODALITIES,
    evidenceRequired: true,
  },
  { id: "workflow", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
  { id: "consistency", builtin: true, appliesTo: ALL_MODALITIES, evidenceRequired: true },
];

export const findingCategoryRegistry = new EveRegistry<FindingCategoryEntry>("finding category");
for (const entry of BUILT_INS) findingCategoryRegistry.register(entry);

// Guard: the registry must seed exactly the type-level built-in set.
for (const id of FINDING_CATEGORIES) {
  if (!findingCategoryRegistry.has(id)) {
    throw new Error(`finding-category registry is out of sync with FINDING_CATEGORIES ("${id}")`);
  }
}

/** Register a new finding category (domain packs; plugins via `onRegister`). */
export function registerFindingCategory(
  entry: Omit<FindingCategoryEntry, "builtin" | "evidenceRequired" | "appliesTo"> &
    Partial<Pick<FindingCategoryEntry, "appliesTo">>,
): void {
  findingCategoryRegistry.register({
    ...entry,
    appliesTo: entry.appliesTo ?? ALL_MODALITIES,
    builtin: false,
    evidenceRequired: true,
  });
}
