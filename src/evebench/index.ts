/**
 * EVE Bench — a formal, multi-dimensional benchmark platform for the
 * experience-validation instrument itself.
 */

export {
  runEveBench,
  EVEBENCH_CASES,
  type EveBenchReport,
  type CaseScore,
  type BenchmarkCase,
  type EveBenchOptions,
} from "./evebench.js";
export { renderEveBenchMarkdown } from "./report.js";
