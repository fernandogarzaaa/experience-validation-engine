/**
 * Product intelligence — infer product-level insight (personas, workflows,
 * business goals, feature importance, high-friction pages, drop-off causes)
 * from a population study's observed behaviour.
 */

export type {
  BusinessGoal,
  DropoffCause,
  FeatureImportance,
  FrictionPage,
  InferredPersona,
  ProductIntelligence,
  Workflow,
} from "./intelligence.js";
export { inferProductIntelligence } from "./intelligence.js";
export { renderProductIntelligenceMarkdown } from "./report.js";
