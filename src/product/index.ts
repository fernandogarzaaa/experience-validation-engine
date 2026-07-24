/**
 * Product intelligence — infer product-level insight (personas, workflows,
 * business goals, feature importance, high-friction pages, drop-off causes)
 * from a population study's observed behaviour.
 */

export { inferProductIntelligence } from "./intelligence.js";
export { renderProductIntelligenceMarkdown } from "./report.js";
export type {
  ProductIntelligence,
  InferredPersona,
  BusinessGoal,
  Workflow,
  FeatureImportance,
  FrictionPage,
  DropoffCause,
} from "./intelligence.js";
