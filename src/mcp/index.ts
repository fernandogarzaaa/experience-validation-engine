/**
 * EVE Model Context Protocol (MCP) integration.
 *
 * Re-exports the server factory, the stdio entry point, and the underlying
 * tool implementations so EVE's MCP surface can be embedded programmatically
 * (e.g. mounted alongside other servers) as well as run standalone via
 * `eve-mcp`.
 */

export { createServer, main } from "./server.js";
export {
  runSession,
  runUsabilityStudy,
  runUserStudy,
  runProductReport,
  listPersonasTool,
  listProfessionsTool,
  listCulturesTool,
  runBenchmark,
  getReport,
  ToolInputError,
  CHARACTER_LIMIT,
  type ToolOutput,
} from "./tools.js";
export {
  RunSessionSchema,
  RunUsabilityStudySchema,
  ListSchema,
  BenchmarkSchema,
  GetReportSchema,
  ResponseFormat,
  BrowserBackend,
  type RunSessionInput,
  type RunUsabilityStudyInput,
  type ListInput,
  type BenchmarkInput,
  type GetReportInput,
} from "./schemas.js";
