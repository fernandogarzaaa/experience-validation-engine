/**
 * Model + parameter version freeze (reviewer: "freeze EVE behavioral model v1").
 *
 * `BEHAVIOR_MODEL_VERSION = 1.0.0` + `PARAMETER_SET_VERSION = 1.0.0`
 * represent the FROZEN c40a730 BASELINE — not "all commits that happen to
 * use these constants". A future reader must interpret 1.0.0 as c40a730,
 * never as covering earlier commits.
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
 * - Documentation-only changes: NO bump.
 * - Bug fixes that change observable model behavior: bump the relevant
 *   version (a silent behavior change without a bump contaminates datasets).
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
