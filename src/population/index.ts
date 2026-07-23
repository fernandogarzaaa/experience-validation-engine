/**
 * Population simulation — run many varied operators against one app and
 * aggregate their experiences into a statistical usability study.
 */

export {
  simulatePopulation,
  sampleOperators,
  type PopulationOptions,
  type PopulationStudy,
  type OperatorSpec,
  type OperatorRun,
  type HeatmapEntry,
  type AggregatedFinding,
} from "./population.js";
export {
  summarize,
  histogram,
  quantile,
  mean,
  stdDev,
  pearson,
  type Distribution,
  type Histogram,
  type HistogramBin,
} from "./stats.js";
export {
  segmentPopulation,
  classifySegment,
  type Segment,
  type SegmentableOperator,
} from "./segments.js";
