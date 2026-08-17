/**
 * The default registry set plugins receive in `EvePlugin.onRegister`.
 *
 * Aggregation lives here (not in `core`) because `core` depends on nothing,
 * while the verb registry is CP/1-adjacent and the dimension registry is
 * scoring-adjacent.
 */

import { findingCategoryRegistry } from "../core/findingCategories.js";
import type { EveRegistries } from "../core/registry.js";
import { actionVerbRegistry } from "../protocol/verbs.js";
import { dimensionRegistry } from "../scoring/dimensions.js";

export const defaultRegistries: EveRegistries = {
  dimensions: dimensionRegistry,
  findingCategories: findingCategoryRegistry,
  actionVerbs: actionVerbRegistry,
};
