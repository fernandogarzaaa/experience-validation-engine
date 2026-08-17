/**
 * Fuzz oracle — deterministic robustness probing of tool inputs.
 *
 * Generates a small, seeded set of adversarial argument sets per tool —
 * type violations, missing required fields, boundary values and one
 * oversized payload — calls the tool with each, and classifies what comes
 * back:
 *
 * | Outcome           | Meaning                                              |
 * | ----------------- | ---------------------------------------------------- |
 * | `protocol-error`  | JSON-RPC error (e.g. -32602) — the correct rejection |
 * | `error-result`    | tool-level `isError` result — acceptable rejection   |
 * | `accepted`        | garbage accepted without complaint — a finding     |
 * | `hang`            | no response within the call timeout — a finding    |
 * | `crash`           | the transport died — critical; fuzzing stops       |
 *
 * Determinism: case selection flows through the session `Rng`, so a report
 * is reproducible from its seed, like every other EVE artifact.
 */

import { createRng, type Rng, seedFromString } from "../core/random.js";
import {
  isConnectionClosedError,
  isTimeoutError,
  type McpConnection,
} from "../surface/mcpClient.js";
import type { AdvertisedTool } from "./schemaOracle.js";
import { makeFinding } from "./schemaOracle.js";
import type { FuzzStats, McpFinding } from "./types.js";

export interface FuzzOptions {
  /** Max adversarial cases per tool (default 6). */
  readonly perTool?: number;
  /** Per-call timeout in ms (default 5000). */
  readonly timeoutMs?: number;
  /** Oversized payload size in characters (default 65536). */
  readonly maxPayloadChars?: number;
  /** Seed for case selection (default 1). */
  readonly seed?: number | string;
}

const DEFAULT_PER_TOOL = 6;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_PAYLOAD_CHARS = 65_536;

type FuzzOutcome = "protocol-error" | "error-result" | "accepted" | "hang" | "crash";

interface FuzzCase {
  readonly label: string;
  /** True when the case is unambiguously invalid and must be rejected. */
  readonly mustReject: boolean;
  readonly args: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function propertyType(schema: Record<string, unknown>, field: string): string | null {
  const properties = schema.properties;
  if (!isRecord(properties)) return null;
  const prop = properties[field];
  if (!isRecord(prop) || typeof prop.type !== "string") return null;
  return prop.type;
}

function requiredFields(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((r): r is string => typeof r === "string")
    : [];
}

function declaredFields(schema: Record<string, unknown>): string[] {
  return isRecord(schema.properties) ? Object.keys(schema.properties) : [];
}

/** A valid-looking skeleton: every declared property gets a tame value. */
function tameValue(type: string | null): unknown {
  switch (type) {
    case "number":
    case "integer":
      return 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "x";
  }
}

/** A value that violates the declared type. */
function violatingValue(type: string | null): unknown {
  switch (type) {
    case "number":
    case "integer":
      return "not-a-number";
    case "string":
      return 42;
    case "boolean":
      return "yes";
    case "array":
      return "not-an-array";
    case "object":
      return "not-an-object";
    default:
      return { unexpected: ["shape"] };
  }
}

function buildCases(
  tool: AdvertisedTool,
  options: Required<Pick<FuzzOptions, "maxPayloadChars">>,
): FuzzCase[] {
  const schema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
  const required = requiredFields(schema);
  const declared = declaredFields(schema);
  const cases: FuzzCase[] = [];

  if (required.length > 0) {
    cases.push({
      label: "missing all required fields",
      mustReject: true,
      args: {},
    });
  }

  const skeleton: Record<string, unknown> = {};
  for (const field of declared) skeleton[field] = tameValue(propertyType(schema, field));

  for (const field of declared) {
    const type = propertyType(schema, field);
    if (type === null) continue;
    cases.push({
      label: `type violation on "${field}" (expected ${type})`,
      mustReject: true,
      args: { ...skeleton, [field]: violatingValue(type) },
    });
  }

  for (const field of declared) {
    const type = propertyType(schema, field);
    if (type === "integer" || type === "number") {
      cases.push({
        label: `boundary value on "${field}" (MAX_SAFE_INTEGER)`,
        mustReject: false,
        args: { ...skeleton, [field]: Number.MAX_SAFE_INTEGER },
      });
      cases.push({
        label: `boundary value on "${field}" (-1)`,
        mustReject: false,
        args: { ...skeleton, [field]: -1 },
      });
    }
    if (type === "string") {
      cases.push({
        label: `boundary value on "${field}" (empty string)`,
        mustReject: false,
        args: { ...skeleton, [field]: "" },
      });
    }
  }

  const payloadField = declared.find((f) => propertyType(schema, f) === "string") ?? declared[0];
  if (payloadField !== undefined) {
    cases.push({
      label: `oversized payload on "${payloadField}" (${options.maxPayloadChars} chars)`,
      mustReject: false,
      args: { ...skeleton, [payloadField]: "x".repeat(options.maxPayloadChars) },
    });
  }

  return cases;
}

export interface FuzzResult {
  readonly findings: McpFinding[];
  readonly stats: FuzzStats;
}

/**
 * Fuzz every advertised tool. Stops early if the server crashes — a dead
 * transport cannot answer further calls, and one crash is already the
 * headline finding.
 */
export async function fuzzTools(
  conn: McpConnection,
  tools: readonly AdvertisedTool[],
  options: FuzzOptions = {},
): Promise<FuzzResult> {
  const perTool = options.perTool ?? DEFAULT_PER_TOOL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxPayloadChars = options.maxPayloadChars ?? DEFAULT_MAX_PAYLOAD_CHARS;
  const rng: Rng = createRng(
    typeof options.seed === "number" ? options.seed : seedFromString(String(options.seed ?? 1)),
  );

  const findings: McpFinding[] = [];
  const stats = {
    toolsFuzzed: 0,
    calls: 0,
    protocolErrors: 0,
    errorResults: 0,
    acceptedInvalid: 0,
    hangs: 0,
    crashes: 0,
  };

  for (const tool of tools) {
    if (conn.closed || stats.crashes > 0) break;
    const name = typeof tool.name === "string" ? tool.name : "(unnamed)";
    const all = buildCases(tool, { maxPayloadChars });
    // Seeded shuffle, then take the budget — reproducible case selection.
    const shuffled = [...all].sort(() => rng.next() - 0.5);
    const cases = shuffled.slice(0, Math.max(1, perTool));
    stats.toolsFuzzed += 1;

    const acceptedLabels: string[] = [];
    for (const fuzzCase of cases) {
      if (conn.closed) break;
      stats.calls += 1;
      const outcome = await classifyCall(conn, name, fuzzCase.args, timeoutMs);
      switch (outcome.kind) {
        case "protocol-error":
          stats.protocolErrors += 1;
          break;
        case "error-result":
          stats.errorResults += 1;
          break;
        case "accepted":
          if (fuzzCase.mustReject) {
            stats.acceptedInvalid += 1;
            acceptedLabels.push(fuzzCase.label);
          }
          break;
        case "hang":
          stats.hangs += 1;
          findings.push(
            makeFinding({
              severity: "major",
              category: "mcp.robustness",
              title: `"${name}" did not answer a fuzzed call within ${timeoutMs}ms`,
              description:
                "An unbounded call is a denial-of-service vector for any client; servers should reject bad input fast.",
              evidence: [`case: ${fuzzCase.label}`, `no response after ${timeoutMs}ms`],
              tool: name,
            }),
          );
          break;
        case "crash":
          stats.crashes += 1;
          findings.push(
            makeFinding({
              severity: "critical",
              category: "mcp.robustness",
              title: `"${name}" crashed the server on fuzzed input`,
              description:
                "The transport died under an adversarial call. A single malformed request must never take the whole server down.",
              evidence: [
                `case: ${fuzzCase.label}`,
                `error: ${outcome.detail}`,
                "remaining fuzz cases skipped — the connection is dead",
              ],
              tool: name,
              recommendation:
                "Validate arguments before use and isolate per-request failures from server lifecycle.",
            }),
          );
          break;
      }
    }

    if (acceptedLabels.length > 0) {
      findings.push(
        makeFinding({
          severity: "minor",
          category: "mcp.robustness",
          title: `"${name}" accepted clearly-invalid arguments`,
          description:
            "Inputs that violate the advertised schema were accepted without a protocol error or an error result — clients cannot trust the schema as a contract.",
          evidence: acceptedLabels.map((label) => `accepted: ${label}`),
          tool: name,
          recommendation:
            "Validate arguments against the input schema and reject violations with a JSON-RPC -32602 error.",
        }),
      );
    }
  }

  return { findings, stats };
}

async function classifyCall(
  conn: McpConnection,
  name: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ kind: FuzzOutcome; detail?: string }> {
  try {
    const outcome = await conn.callTool(name, args, timeoutMs);
    return { kind: outcome.isError ? "error-result" : "accepted" };
  } catch (error) {
    if (conn.closed || isConnectionClosedError(error)) {
      return { kind: "crash", detail: error instanceof Error ? error.message : String(error) };
    }
    if (isTimeoutError(error)) return { kind: "hang" };
    // Any other rejection is the JSON-RPC layer answering with an error —
    // exactly how a server should dismiss garbage.
    return {
      kind: "protocol-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
