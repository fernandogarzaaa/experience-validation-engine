/**
 * Continuous UX regression — track experience trends across a series of builds
 * and surface improvements and regressions per metric.
 */

export { renderTrendReportMarkdown } from "./report.js";
export {
  analyzeTrends,
  type BuildSnapshot,
  type MetricTrend,
  metricsFromStudy,
  TREND_METRICS,
  type TrendDirection,
  type TrendMetricKey,
  type TrendReport,
} from "./trends.js";
