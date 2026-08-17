/**
 * The MCP evaluation entry point: connect to a server, run the Phase-1
 * tier-1 (deterministic) oracles, and produce an evidence-backed report.
 *
 * Oracle mix (see `docs/mcp-adapter.md`):
 * - schema oracle   → `mcp.schemaQuality`   (no calls; pure advertisement checks)
 * - conformance     → `mcp.conformance`     (handshake, capabilities, ping, error codes)
 * - fuzz oracle     → `mcp.robustness`      (seeded adversarial inputs, crash/hang classification)
 *
 * Scoring follows the scorer's philosophy — derived measurements, never
 * vibes: each dimension starts at 100 and is deducted per finding severity
 * (critical 25 / major 12 / minor 4 / info 1, the same schedule the session
 * scorer uses), with the driving findings cited as evidence.
 */

import { scoreFromFindings } from "../scoring/scorer.js";
import { connectMcpServer, type McpConnector } from "../surface/mcpClient.js";
import { checkConformance } from "./conformanceOracle.js";
import { type FuzzOptions, fuzzTools } from "./fuzzOracle.js";
import { checkToolSchemas, resetFindingIds } from "./schemaOracle.js";
import {
  DIMENSION_FOR_CATEGORY,
  MCP_DIMENSIONS,
  type McpDimension,
  type McpDimensionScore,
  type McpEvalReport,
  type McpFinding,
} from "./types.js";
import { registerMcpVocabulary } from "./vocabulary.js";

export interface EvaluateMcpOptions {
  /** Override the transport (tests inject an in-process fixture server). */
  readonly connector?: McpConnector;
  /** Fuzzing is on by default; pass false to skip, or options to tune it. */
  readonly fuzz?: boolean | FuzzOptions;
}

/**
 * Score one MCP dimension from its findings. Phase 2 retired the parallel
 * penalty schedule that used to live here: this delegates to
 * {@link scoreFromFindings}, the session scorer's generic registered-
 * dimension rule, so there is exactly one severity schedule in EVE.
 */
function scoreDimension(
  dimension: McpDimension,
  findings: readonly McpFinding[],
): McpDimensionScore {
  const relevant = findings.filter((f) => DIMENSION_FOR_CATEGORY[f.category] === dimension);
  const scored = scoreFromFindings(dimension, relevant);
  return { dimension, value: scored.value, evidence: scored.evidence };
}

/**
 * Evaluate one MCP server and return the full report. The connection is
 * always closed before returning, including on oracle failure.
 *
 * Target forms: `node server.js --flag` (stdio), `http(s)://…` (HTTP), or
 * anything accepted by the injected connector. An `mcp:` scheme prefix is
 * stripped if present.
 */
export async function evaluateMcpServer(
  target: string,
  options: EvaluateMcpOptions = {},
): Promise<McpEvalReport> {
  registerMcpVocabulary();
  resetFindingIds();
  const bareTarget = target.startsWith("mcp:") ? target.slice(4) : target;
  const connector = options.connector ?? connectMcpServer;
  const started = Date.now();

  const conn = await connector(bareTarget);
  try {
    const tools = await conn.listTools();
    const findings: McpFinding[] = [...checkToolSchemas(tools)];

    const conformance = await checkConformance(conn);
    findings.push(...conformance.findings);

    let fuzz: McpEvalReport["fuzz"] = null;
    if (options.fuzz !== false && tools.length > 0 && !conn.closed) {
      const fuzzOptions = typeof options.fuzz === "object" ? options.fuzz : {};
      const result = await fuzzTools(conn, tools, fuzzOptions);
      findings.push(...result.findings);
      fuzz = result.stats;
    }

    const info = conn.serverInfo;
    return {
      target: bareTarget,
      server: info ? { name: info.name, version: info.version } : null,
      toolCount: tools.length,
      listChanged: conformance.listChanged,
      findings,
      scores: MCP_DIMENSIONS.map((dimension) => scoreDimension(dimension, findings)),
      fuzz,
      durationMs: Date.now() - started,
    };
  } finally {
    await conn.close().catch(() => {});
  }
}

/** Render the report as Markdown (CLI output and CI logs). */
export function renderMcpEvalMarkdown(report: McpEvalReport): string {
  const lines: string[] = [];
  lines.push(`# MCP evaluation — ${report.target}`);
  lines.push("");
  lines.push(
    report.server
      ? `Server: **${report.server.name}** v${report.server.version} · ${report.toolCount} tool(s) · listChanged: ${report.listChanged ?? "n/a"}`
      : `Server: unidentified · ${report.toolCount} tool(s)`,
  );
  lines.push("");
  lines.push("## Scores");
  for (const score of report.scores) {
    lines.push(`- **${score.dimension}: ${score.value}/100**`);
  }
  if (report.fuzz) {
    const f = report.fuzz;
    lines.push("");
    lines.push(
      `Fuzzing: ${f.calls} call(s) over ${f.toolsFuzzed} tool(s) — ${f.protocolErrors} protocol errors, ${f.errorResults} error results, ${f.acceptedInvalid} accepted-invalid, ${f.hangs} hang(s), ${f.crashes} crash(es)`,
    );
  }
  lines.push("");
  lines.push("## Findings");
  if (report.findings.length === 0) lines.push("No findings.");
  for (const finding of report.findings) {
    lines.push(`- **[${finding.severity}]** ${finding.title} _(${finding.category})_`);
    for (const ev of finding.evidence) lines.push(`  - ${ev}`);
  }
  return `${lines.join("\n")}\n`;
}
