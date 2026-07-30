/**
 * Population simulation — run many varied operators against one app and
 * aggregate their experiences into a statistical usability study.
 */

export {
  type AggregatedFinding,
  type HeatmapEntry,
  type OperatorRun,
  type OperatorSpec,
  type PopulationOptions,
  type PopulationStudy,
  sampleOperators,
  simulatePopulation,
} from "./population.js";
export {
  classifySegment,
  type Segment,
  type SegmentableOperator,
  segmentPopulation,
} from "./segments.js";
export {
  type Distribution,
  type Histogram,
  type HistogramBin,
  histogram,
  mean,
  pearson,
  quantile,
  stdDev,
  summarize,
} from "./stats.js";
