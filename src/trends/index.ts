/**
 * Continuous UX regression — track experience trends across a series of builds
 * and surface improvements and regressions per metric.
 */

export {
  analyzeTrends,
  metricsFromStudy,
  TREND_METRICS,
  type TrendReport,
  type MetricTrend,
  type BuildSnapshot,
  type TrendDirection,
  type TrendMetricKey,
} from "./trends.js";
export { renderTrendReportMarkdown } from "./report.js";
