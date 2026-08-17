/**
 * Conformance oracle — does the server honor the protocol basics?
 *
 * Deterministic checks over a live connection:
 *
 * 1. **Initialize handshake** — the connection established at all, and the
 *    server identified itself (name + version).
 * 2. **Capability declaration** — a server that answers `tools/list` must
 *    declare the `tools` capability at initialize; `listChanged` support is
 *    recorded for the report (it is optional, so never a finding).
 * 3. **Ping** — the liveness method must be answered.
 * 4. **Error codes** — calling a nonexistent tool must produce a JSON-RPC
 *    protocol error (-32602 invalid params, or -32601 method not found on
 *    older servers), not a fake success and not a crash.
 */

import {
  isConnectionClosedError,
  isTimeoutError,
  type McpConnection,
} from "../surface/mcpClient.js";
import { makeFinding } from "./schemaOracle.js";
import type { McpFinding } from "./types.js";

const UNKNOWN_TOOL_NAME = "__eve_conformance_probe_no_such_tool__";
const PING_TIMEOUT_MS = 5_000;

export interface ConformanceResult {
  readonly findings: McpFinding[];
  /** null = the server declared no `tools` capability at all. */
  readonly listChanged: boolean | null;
}

export async function checkConformance(conn: McpConnection): Promise<ConformanceResult> {
  const findings: McpFinding[] = [];
  const capabilities = conn.serverCapabilities;
  const toolsCapability =
    capabilities && typeof capabilities === "object"
      ? (capabilities as { tools?: { listChanged?: boolean } }).tools
      : undefined;

  /* ---- initialize handshake ---- */
  const info = conn.serverInfo;
  if (!info?.name) {
    findings.push(
      makeFinding({
        severity: "minor",
        category: "mcp.conformance",
        title: "Server did not identify itself at initialize",
        description:
          "The initialize result should carry serverInfo with a name and version; clients show this to users deciding whether to trust the server.",
        evidence: [`serverInfo = ${JSON.stringify(info ?? null)}`],
      }),
    );
  }

  /* ---- capability declaration ---- */
  if (toolsCapability === undefined) {
    findings.push(
      makeFinding({
        severity: "major",
        category: "mcp.conformance",
        title: "Server serves tools without declaring the tools capability",
        description:
          "A server that answers tools/list must declare capabilities.tools at initialize; spec-conformant clients may not even attempt tools/list otherwise.",
        evidence: [`capabilities = ${JSON.stringify(capabilities ?? null)}`],
      }),
    );
  }

  /* ---- ping ---- */
  try {
    await conn.ping();
  } catch (error) {
    findings.push(
      makeFinding({
        severity: isConnectionClosedError(error) ? "critical" : "major",
        category: "mcp.conformance",
        title: "Server does not answer ping",
        description: "ping is the protocol's liveness method; every server must answer it.",
        evidence: [`ping rejected: ${error instanceof Error ? error.message : String(error)}`],
      }),
    );
  }

  /* ---- unknown-tool error behavior ---- */
  if (!conn.closed) {
    try {
      const outcome = await conn.callTool(UNKNOWN_TOOL_NAME, {}, PING_TIMEOUT_MS);
      if (outcome.isError) {
        findings.push(
          makeFinding({
            severity: "minor",
            category: "mcp.conformance",
            title: "Unknown tool reported as a tool error, not a protocol error",
            description:
              "Calling a nonexistent tool should fail at the protocol layer (-32602 invalid params); an isError result makes a routing bug indistinguishable from a tool failure.",
            evidence: [
              `tools/call "${UNKNOWN_TOOL_NAME}" returned isError: "${outcome.text.slice(0, 120)}"`,
            ],
          }),
        );
      } else {
        findings.push(
          makeFinding({
            severity: "major",
            category: "mcp.conformance",
            title: "Calling a nonexistent tool succeeded",
            description:
              "The server answered a call for a tool it does not advertise as if it were a success — a serious routing/validation defect.",
            evidence: [
              `tools/call "${UNKNOWN_TOOL_NAME}" returned: "${outcome.text.slice(0, 120)}"`,
            ],
          }),
        );
      }
    } catch (error) {
      if (conn.closed || isConnectionClosedError(error)) {
        findings.push(
          makeFinding({
            severity: "critical",
            category: "mcp.conformance",
            title: "Server crashed on an unknown-tool call",
            description: "A well-formed call for a missing tool must never take the server down.",
            evidence: [`error: ${error instanceof Error ? error.message : String(error)}`],
          }),
        );
      } else if (isTimeoutError(error)) {
        findings.push(
          makeFinding({
            severity: "major",
            category: "mcp.conformance",
            title: "Server hung on an unknown-tool call",
            description: "Unknown methods should be rejected immediately with a protocol error.",
            evidence: [`no response within ${PING_TIMEOUT_MS}ms`],
          }),
        );
      }
      // Any other rejection is the expected JSON-RPC protocol error — good.
    }
  }

  return {
    findings,
    listChanged: toolsCapability === undefined ? null : toolsCapability.listChanged === true,
  };
}
