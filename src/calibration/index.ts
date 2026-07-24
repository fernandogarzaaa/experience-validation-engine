/**
 * Human validation engine — import anonymized human usability traces and score
 * how closely EVE's simulated population matches real human behaviour.
 */

export { calibrate, importHumanStudy } from "./calibration.js";
export { renderCalibrationMarkdown } from "./report.js";
export type { HumanTrace, HumanStudy, CalibrationReport } from "./types.js";
