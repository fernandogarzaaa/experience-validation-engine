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
  RunUsabilityStudySchema,
  CompareBuildsSchema,
  ApplicationMapSchema,
  TwinSessionSchema,
  ListSchema,
  BenchmarkSchema,
  GetReportSchema,
  ResponseFormat,
  type RunSessionInput,
  type RunUsabilityStudyInput,
  type CompareBuildsInput,
  type ApplicationMapInput,
  type TwinSessionInput,
  type ListInput,
  type BenchmarkInput,
  type GetReportInput,
} from "./schemas.js";
import {
  runSession,
  runUsabilityStudy,
  runUserStudy,
  runProductReport,
  compareBuilds,
  runApplicationMap,
  runPredictUX,
  runTwinSessionTool,
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
    "eve_run_usability_study",
    {
      title: "Run a population usability study",
      description:
        "Simulate a whole population of varied operators (different personas, " +
        "confidence, patience, professions, cultures) against the same app and " +
        "aggregate the results into a statistical usability study: success and " +
        "drop-off rates, confidence/frustration/trust distributions, a " +
        "task-completion histogram, a navigation heatmap, the expected user " +
        "segments, and the findings most humans hit. This is what you run before " +
        "shipping to answer 'how will the distribution of real users fare?' — " +
        "the population analogue of eve_run_session. Offline with `mock:`. Set " +
        "output_dir to also write the full research dataset (JSON/CSV/Markdown).",
      inputSchema: RunUsabilityStudySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: RunUsabilityStudyInput) => {
      try {
        return respond(await runUsabilityStudy(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_run_user_study",
    {
      title: "Run an AI-moderated user study",
      description:
        "Run a full autonomous user study: simulate a population, then convene a " +
        "panel of specialist AI researchers — UX Researcher, Interaction " +
        "Designer, Accessibility Specialist, QA Engineer, Behavioral " +
        "Psychologist, and Product Manager — who each file an independent report, " +
        "and a moderator who synthesizes them into an executive report with a " +
        "release verdict (ship / ship-with-fixes / do-not-ship), the panel's " +
        "consensus and conflicts, and a prioritized recommendation list. Use this " +
        "when you want a decision and a rationale, not just raw numbers. Offline " +
        "with `mock:`. Same inputs as eve_run_usability_study; set output_dir to " +
        "also write the study dataset and the moderated report.",
      inputSchema: RunUsabilityStudySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: RunUsabilityStudyInput) => {
      try {
        return respond(await runUserStudy(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_predict_ux",
    {
      title: "Predict UX with confidence intervals",
      description:
        "Run a population, then extrapolate to the wider user base: predicted " +
        "abandonment, confusion, onboarding-failure, and accessibility-barrier " +
        "rates (each a proportion with a 95% Wilson confidence interval), a " +
        "modeled support-contact rate per 100 users, and the screens predicted " +
        "to cause struggle. Use to forecast where and how much users will " +
        "struggle before you ship. Offline with `mock:`.",
      inputSchema: RunUsabilityStudySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: RunUsabilityStudyInput) => {
      try {
        return respond(await runPredictUX(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_product_report",
    {
      title: "Infer product intelligence",
      description:
        "Run a population, then infer product-level intelligence from how it " +
        "behaved — the user personas the population reveals, the business goals " +
        "its traffic serves, the critical workflows people traverse, feature " +
        "importance, high-friction pages, and the causes of drop-off. Produces " +
        "product insight, not just UX findings, so a PM or founder can see what " +
        "the product is for and where it leaks. Offline with `mock:`. Same inputs " +
        "as eve_run_usability_study.",
      inputSchema: RunUsabilityStudySchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: RunUsabilityStudyInput) => {
      try {
        return respond(await runProductReport(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_twin_session",
    {
      title: "Run a session as a persistent digital twin",
      description:
        "Run one session as a named, persistent digital twin — a user model that " +
        "evolves across sessions. On first use (provide `name` and " +
        "`base_persona`) the twin is created; thereafter it is loaded from " +
        "`twin_file`, remembers the apps it has used, grows more expert, and its " +
        "confidence baseline drifts toward its lived experience. Call repeatedly " +
        "with the same twin_file/twin_id to watch it evolve (e.g. get faster on a " +
        "familiar app). Offline with `mock:`.",
      inputSchema: TwinSessionSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: TwinSessionInput) => {
      try {
        return respond(await runTwinSessionTool(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_application_map",
    {
      title: "Autonomously map an application",
      description:
        "Given only a URL, explore the app with several curious operators and " +
        "reconstruct a complete application map from what they perceived — the " +
        "screens and their inferred purpose, the navigation graph (as a Mermaid " +
        "diagram), the information architecture, entry points, hubs, dead-ends, " +
        "and affordances no operator got to exercise (candidate hidden / edge " +
        "functionality). No predefined workflows and no app source — perception " +
        "only. Offline with `mock:`.",
      inputSchema: ApplicationMapSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: ApplicationMapInput) => {
      try {
        return respond(await runApplicationMap(input), input.response_format);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "eve_compare_builds",
    {
      title: "Compare experience across builds",
      description:
        "Run a usability study on each of several builds (ordered oldest to " +
        "newest) and analyze the experience trend across them — detecting which " +
        "metrics improved, regressed, or held steady (success rate, drop-off, " +
        "overall score, confidence, frustration, trust, effort). This is " +
        "continuous UX regression: catch an experience regression between builds " +
        "even when functional tests stay green. Use `mock:` builds offline.",
      inputSchema: CompareBuildsSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input: CompareBuildsInput) => {
      try {
        return respond(await compareBuilds(input), input.response_format);
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
