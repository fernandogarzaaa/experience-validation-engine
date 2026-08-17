/**
 * Types for the MCP evaluation harness (Phase-1 tier-1 oracles).
 *
 * These types deliberately mirror `Finding`/`Score` from `src/core/types.ts`
 * but with the category/dimension vocabularies the MCP pack registers via
 * the Phase-0 registries (`registerMcpVocabulary`). They are *not* folded
 * into the closed `FindingCategory`/`ScoreDimension` unions — widening
 * those types is Phase-2 core work. When MCP findings are later merged into
 * session reports, the registry entries guarantee the ids resolve and carry
 * `appliesTo`/`evidenceRequired` metadata.
 */

import type { FindingSeverity } from "../core/types.js";

/** Finding categories this pack registers in `findingCategoryRegistry`. */
export const MCP_FINDING_CATEGORIES = [
  "mcp.schema-quality",
  "mcp.robustness",
  "mcp.conformance",
] as const;

export type McpFindingCategory = (typeof MCP_FINDING_CATEGORIES)[number];

/** Score dimensions this pack registers in `dimensionRegistry`. */
export const MCP_DIMENSIONS = ["mcp.schemaQuality", "mcp.robustness", "mcp.conformance"] as const;

export type McpDimension = (typeof MCP_DIMENSIONS)[number];

/** Finding category ↔ score dimension correspondence. */
export const DIMENSION_FOR_CATEGORY: Record<McpFindingCategory, McpDimension> = {
  "mcp.schema-quality": "mcp.schemaQuality",
  "mcp.robustness": "mcp.robustness",
  "mcp.conformance": "mcp.conformance",
};

/** An evidence-backed finding about an MCP server. Mirrors `Finding`. */
export interface McpFinding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly category: McpFindingCategory;
  readonly title: string;
  readonly description: string;
  /** What the evaluator observed — never vibes. */
  readonly evidence: readonly string[];
  /** The tool this finding is about, when specific to one. */
  readonly tool?: string;
  readonly recommendation?: string;
}

/** A 0..100 score on one MCP dimension, with its derivation. Mirrors `Score`. */
export interface McpDimensionScore {
  readonly dimension: McpDimension;
  readonly value: number;
  readonly evidence: readonly string[];
}

/** Aggregate fuzz-run statistics. */
export interface FuzzStats {
  readonly toolsFuzzed: number;
  readonly calls: number;
  /** Rejected with a proper JSON-RPC protocol error (the correct behavior). */
  readonly protocolErrors: number;
  /** Rejected with a tool-level `isError` result (acceptable). */
  readonly errorResults: number;
  /** Clearly-invalid input accepted without any error. */
  readonly acceptedInvalid: number;
  /** No response within the call timeout. */
  readonly hangs: number;
  /** The transport died under a call (server crash). */
  readonly crashes: number;
}

/** The full Phase-1 evaluation report for one MCP server. */
export interface McpEvalReport {
  readonly target: string;
  readonly server: { readonly name: string; readonly version: string } | null;
  readonly toolCount: number;
  /** Whether the server advertises `tools.listChanged` (null: no tools capability). */
  readonly listChanged: boolean | null;
  readonly findings: readonly McpFinding[];
  readonly scores: readonly McpDimensionScore[];
  /** Null when fuzzing was disabled or never ran (e.g. zero tools). */
  readonly fuzz: FuzzStats | null;
  readonly durationMs: number;
}
