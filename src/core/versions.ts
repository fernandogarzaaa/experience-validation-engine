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

/**
 * EVE adapter implementation version (reviewer: minimal adapter identity
 * contract). This versions the ADAPTER IMPLEMENTATION only — it says nothing
 * about the underlying browser engine, driver, device profile, or OS.
 * A richer execution-environment fingerprint (engine/version, driver,
 * device, runtime) can extend — never replace — this field.
 *
 * Keep in sync with package.json `version`.
 */
export const ADAPTER_VERSION = "0.5.0";

/**
 * Source revision / build identifier for reproducibility (reviewer §10).
 *
 * Populated from `EVE_IMPLEMENTATION_REVISION` when set (CI stamps the git
 * SHA there at build time). Null in ordinary development runs — an explicit
 * unknown, never a fabricated value. Prevents silent divergence where two
 * commits share `BEHAVIOR_MODEL_VERSION` but behave differently.
 */
export function implementationRevision(): string | null {
  const rev = typeof process !== "undefined" ? process.env?.EVE_IMPLEMENTATION_REVISION : undefined;
  const trimmed = rev?.trim();
  return trimmed ? trimmed : null;
}
