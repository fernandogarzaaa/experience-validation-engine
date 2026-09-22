/**
 * Human validation engine — import anonymized human usability traces and score
 * how closely EVE's simulated population matches real human behaviour.
 */

export type {
  AlignedPair,
  AlignmentBasis,
  EveAlignStep,
  HumanStep,
  TraceAlignment,
} from "./alignment.js";
export { alignTraces, importHumanSteps } from "./alignment.js";
export { calibrate, importHumanStudy } from "./calibration.js";
export type { EnvironmentFingerprint } from "./environment.js";
export { fingerprintEnvironment } from "./environment.js";
export {
  brierScore,
  meanLogDurationError,
  spearmanRankCorrelation,
  topKAgreement,
  transitionDivergenceL1,
} from "./metrics.js";
export type {
  ParameterBounds,
  ParameterClassification,
  ParameterDefinition,
  ParameterSet,
} from "./parameters.js";
export {
  BEHAVIOR_PARAMETERS,
  getParameter,
  parametersByClass,
  snapshotParameters,
} from "./parameters.js";
export type {
  CalibrationDataset,
  CalibrationRecord,
  CalibrationStatus,
  HumanIterationReference,
  HumanRecovery,
  HumanRecoveryKind,
} from "./record.js";
export {
  buildCalibrationDataset,
  buildCalibrationRecords,
  recordsFromTrace,
  renderCalibrationRecordsJsonl,
} from "./record.js";
export { renderCalibrationMarkdown } from "./report.js";
export {
  isSecretFieldName,
  REDACTED_EMAIL,
  REDACTED_SECRET,
  redactTextSecrets,
  sanitizeHumanStep,
  sanitizeHumanStudy,
  sanitizeHumanTrace,
  sanitizeTraceUrl,
} from "./sanitize.js";
export type { CalibrationReport, HumanStudy, HumanTrace } from "./types.js";
