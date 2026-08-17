/**
 * MCP server evaluation (Phase 1 of the expansion roadmap).
 *
 * - `McpAdapter` (`src/surface/mcp.ts`) projects an MCP server onto the
 *   textual-surface seam so personas can operate it through the normal
 *   session loop (`eve run mcp:…`).
 * - The oracles here are the deterministic tier-1 evaluators: schema
 *   quality, protocol conformance, and seeded robustness fuzzing
 *   (`evaluateMcpServer` / `eve mcp-eval`).
 */

export { type ConformanceResult, checkConformance } from "./conformanceOracle.js";
export {
  type EvaluateMcpOptions,
  evaluateMcpServer,
  renderMcpEvalMarkdown,
} from "./evaluate.js";
export { type FuzzOptions, type FuzzResult, fuzzTools } from "./fuzzOracle.js";
export { type AdvertisedTool, checkToolSchemas } from "./schemaOracle.js";
export {
  DIMENSION_FOR_CATEGORY,
  type FuzzStats,
  MCP_DIMENSIONS,
  MCP_FINDING_CATEGORIES,
  type McpDimension,
  type McpDimensionScore,
  type McpEvalReport,
  type McpFinding,
  type McpFindingCategory,
} from "./types.js";
export { registerMcpVocabulary } from "./vocabulary.js";
