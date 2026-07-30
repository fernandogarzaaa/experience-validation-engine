/**
 * EVE Model Context Protocol (MCP) integration.
 *
 * Re-exports the server factory, the stdio entry point, and the underlying
 * tool implementations so EVE's MCP surface can be embedded programmatically
 * (e.g. mounted alongside other servers) as well as run standalone via
 * `eve-mcp`.
 */

export {
  type ApplicationMapInput,
  ApplicationMapSchema,
  type BenchmarkInput,
  BenchmarkSchema,
  BrowserBackend,
  type CalibrateInput,
  CalibrateSchema,
  type CompareBuildsInput,
  CompareBuildsSchema,
  type EveBenchInput,
  EveBenchSchema,
  type GetReportInput,
  GetReportSchema,
  type ListInput,
  ListSchema,
  type MultimodalScanInput,
  MultimodalScanSchema,
  ResponseFormat,
  type RunSessionInput,
  RunSessionSchema,
  type RunUsabilityStudyInput,
  RunUsabilityStudySchema,
  type TwinSessionInput,
  TwinSessionSchema,
} from "./schemas.js";
export { createServer, main } from "./server.js";
export {
  CHARACTER_LIMIT,
  compareBuilds,
  getReport,
  listCulturesTool,
  listPersonasTool,
  listProfessionsTool,
  runApplicationMap,
  runBenchmark,
  runCalibrate,
  runEveBenchTool,
  runMultimodalScan,
  runPredictUX,
  runProductReport,
  runSession,
  runTwinSessionTool,
  runUsabilityStudy,
  runUserStudy,
  ToolInputError,
  type ToolOutput,
} from "./tools.js";
