/**
 * EVE MCP server (`eve-mcp-server`).
 *
 * Exposes the Experience Validation Engine as Model Context Protocol tools so
 * it can be driven from any MCP-capable AI client — Claude Desktop, Claude
 * Code, Codex, Cursor, Windsurf, VS Code, and others. Uses the stdio transport
 * (the client launches this as a subprocess), so nothing is ever written to
 * stdout except the MCP protocol itself; diagnostics go to stderr.
 *
 * Run directly with `eve-mcp` (see bin/eve-mcp.js) or `node dist/mcp/server.js`.
 */

import { createRequire } from "node:module";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  RunSessionSchema,
  ListSchema,
  BenchmarkSchema,
  GetReportSchema,
  ResponseFormat,
  type RunSessionInput,
  type ListInput,
  type BenchmarkInput,
  type GetReportInput,
} from "./schemas.js";
import {
  runSession,
  listPersonasTool,
  listProfessionsTool,
  listCulturesTool,
  runBenchmark,
  getReport,
  ToolInputError,
  type ToolOutput,
} from "./tools.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Render a tool output in the requested format as an MCP tool result. */
function respond(output: ToolOutput, format: ResponseFormat) {
  const text =
    format === ResponseFormat.JSON
      ? JSON.stringify(output.structured, null, 2)
      : output.markdown;
  return { content: [{ type: "text" as const, text }] };
}

/** Turn any thrown error into an actionable MCP tool error result. */
function fail(error: unknown) {
  const message =
    error instanceof ToolInputError
      ? error.message
      : `EVE error: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "eve-mcp-server",
    version: pkg.version,
  });

  server.registerTool(
    "eve_run_session",
    {
      title: "Run an EVE experience-validation session",
      description:
        "Simulate a realistic human (a persona with reading speed, memory, " +
        "emotions and patience) using a web app through a browser, then return " +
        "an evidence-backed experience report: an overall score (0-100), " +
        "severity-ranked findings, the outcome (goal achieved / abandoned / " +
        "budget exhausted), and first-person journal highlights explaining why " +
        "the user reacted as they did. Use `mock:` as the URL for an offline " +
        "demo that needs no browser. The full report.html/md/json is written to " +
        "output_dir; read it back with eve_get_report. This is experience/UX " +
        "validation, not functional or unit testing.",
      inputSchema: RunSessionSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: RunSessionInput) => {
      try {
        return respond(await runSession(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_list_personas",
    {
      title: "List EVE personas",
      description:
        "List the built-in personas that eve_run_session can simulate " +
        "(e.g. first-time-user, impatient-user, power-user, elderly-user, " +
        "accessibility-user), each with a description of who they model.",
      inputSchema: ListSchema.shape,
      annotations: READ_ONLY,
    },
    async (input: ListInput) => respond(listPersonasTool(), input.response_format),
  );

  server.registerTool(
    "eve_list_professions",
    {
      title: "List EVE professional overlays",
      description:
        "List the professional overlays (doctor, accountant, lawyer, designer, " +
        "…) that can be layered onto a persona via eve_run_session's " +
        "`profession` argument to add domain vocabulary and workflow priorities.",
      inputSchema: ListSchema.shape,
      annotations: READ_ONLY,
    },
    async (input: ListInput) => respond(listProfessionsTool(), input.response_format),
  );

  server.registerTool(
    "eve_list_cultures",
    {
      title: "List EVE cultural profiles",
      description:
        "List the cultural profiles / locales (en-US, de-DE, ja-JP, ar-SA, …) " +
        "that can be applied via eve_run_session's `culture` argument, affecting " +
        "reading direction, formats, and expectations.",
      inputSchema: ListSchema.shape,
      annotations: READ_ONLY,
    },
    async (input: ListInput) => respond(listCulturesTool(), input.response_format),
  );

  server.registerTool(
    "eve_benchmark",
    {
      title: "Validate EVE against benchmark apps",
      description:
        "Run EVE against known-good and known-bad reference apps and check that " +
        "it ranks them correctly (excellent > average > bad). A construct-" +
        "validity gate for the instrument itself; runs fully offline.",
      inputSchema: BenchmarkSchema.shape,
      annotations: READ_ONLY,
    },
    async (input: BenchmarkInput) => {
      try {
        return respond(await runBenchmark(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_get_report",
    {
      title: "Read a full EVE report",
      description:
        "Read back the full report a prior eve_run_session wrote to disk — the " +
        "complete markdown report (executive summary, scored dimensions with " +
        "evidence, findings, emotional timeline, session journal) or the full " +
        "JSON. Use this when the run summary isn't enough detail.",
      inputSchema: GetReportSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: GetReportInput) => {
      try {
        const output = await getReport(input);
        return { content: [{ type: "text" as const, text: output.markdown }] };
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

/** Start the server over stdio. */
export async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`eve-mcp-server ${pkg.version} ready (stdio)\n`);
}
