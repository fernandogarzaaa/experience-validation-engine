/**
 * The MCP pack's vocabulary registration (Phase-0 registries in action).
 *
 * Registers the `mcp.*` score dimensions, finding categories and the
 * engine-side `mcp.invoke` action verb. All entries are textual-only
 * (`appliesTo: ["textual"]`) — they are meaningless on a pixel surface —
 * and, per the registry contract, `evidenceRequired: true` and
 * `onCp1Wire: false` are forced by the register functions themselves.
 *
 * Registration is idempotent: the module-level guard plus per-entry `has()`
 * checks make repeated imports and repeated calls safe (registries are
 * process-global singletons and reject duplicates loudly).
 */

import { findingCategoryRegistry, registerFindingCategory } from "../core/findingCategories.js";
import { actionVerbRegistry, registerActionVerb } from "../protocol/verbs.js";
import { dimensionRegistry, registerDimension } from "../scoring/dimensions.js";
import { DIMENSION_FOR_CATEGORY, MCP_DIMENSIONS, MCP_FINDING_CATEGORIES } from "./types.js";

const TEXTUAL_ONLY = ["textual"] as const;

const DIMENSION_DESCRIPTIONS: Record<(typeof MCP_DIMENSIONS)[number], string> = {
  "mcp.schemaQuality":
    "Correctness and descriptive quality of advertised tool schemas (JSON Schema validity, required-field consistency, description quality, annotation honesty).",
  "mcp.robustness":
    "Behavior under malformed, boundary and oversized tool inputs (protocol-error rejection, no crashes, no hangs).",
  "mcp.conformance":
    "Protocol conformance: initialize handshake, capability declaration, ping, and correct error codes for unknown tools.",
};

const CATEGORY_DESCRIPTIONS: Record<(typeof MCP_FINDING_CATEGORIES)[number], string> = {
  "mcp.schema-quality": "A defect in an advertised tool schema, description or annotations.",
  "mcp.robustness": "A crash, hang or validation failure observed under fuzzed tool inputs.",
  "mcp.conformance": "A deviation from MCP protocol expectations.",
};

let registered = false;

/** Register the MCP pack's dimensions, finding categories and action verb. */
export function registerMcpVocabulary(): void {
  if (registered) return;
  registered = true;

  for (const id of MCP_DIMENSIONS) {
    if (!dimensionRegistry.has(id)) {
      registerDimension({
        id,
        description: DIMENSION_DESCRIPTIONS[id],
        weight: 0,
        appliesTo: TEXTUAL_ONLY,
      });
    }
  }

  for (const id of MCP_FINDING_CATEGORIES) {
    if (!findingCategoryRegistry.has(id)) {
      registerFindingCategory({
        id,
        description: CATEGORY_DESCRIPTIONS[id],
        appliesTo: TEXTUAL_ONLY,
        // Phase 2: findings in this category deduct from the linked
        // dimension through the session scorer's generic rule.
        scoresInto: DIMENSION_FOR_CATEGORY[id],
      });
    }
  }

  if (!actionVerbRegistry.has("mcp.invoke")) {
    registerActionVerb({
      id: "mcp.invoke",
      description:
        "Invoke an MCP tool with arguments (projected as a form submission on the MCP surface).",
      appliesTo: TEXTUAL_ONLY,
    });
  }
}
