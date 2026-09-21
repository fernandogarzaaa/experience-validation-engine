/**
 * Model + parameter version freeze (reviewer: "freeze EVE behavioral model v1").
 *
 * Calibration is meaningless against a moving model: if the architecture or
 * the default parameters change under a dataset, nobody can tell whether an
 * improvement came from better parameters, a more expressive model,
 * overfitting, or benchmark leakage. So:
 *
 * - `BEHAVIOR_MODEL_VERSION` bumps on ANY architectural/behavioral change
 *   (cognition cascade, identity rules, appraisal, motor model, ...).
 * - `PARAMETER_SET_VERSION` bumps when a default parameter value changes
 *   (persona baselines, thresholds, weights, bands, ...).
 *
 * Any bump requires recalibration: the new version starts `uncalibrated`
 * regardless of what v1 achieved. Every `CalibrationRecord` carries both,
 * so a prediction made in September 2026 is reproducible and auditable.
 */

export const BEHAVIOR_MODEL_VERSION = "1.0.0";

export const PARAMETER_SET_VERSION = "1.0.0";
