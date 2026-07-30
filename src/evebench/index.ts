/**
 * EVE Bench — a formal, multi-dimensional benchmark platform for the
 * experience-validation instrument itself.
 */

export {
  type BenchmarkCase,
  type CaseScore,
  EVEBENCH_CASES,
  type EveBenchOptions,
  type EveBenchReport,
  runEveBench,
} from "./evebench.js";
export { renderEveBenchMarkdown } from "./report.js";
