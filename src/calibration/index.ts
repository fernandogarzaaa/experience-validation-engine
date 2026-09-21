/**
 * Human validation engine — import anonymized human usability traces and score
 * how closely EVE's simulated population matches real human behaviour.
 */

export { calibrate, importHumanStudy } from "./calibration.js";
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
  renderCalibrationRecordsJsonl,
} from "./record.js";
export { renderCalibrationMarkdown } from "./report.js";
export type { CalibrationReport, HumanStudy, HumanTrace } from "./types.js";
