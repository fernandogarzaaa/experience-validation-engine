/**
 * Fitness measurement — EVE's role in the developmental lifecycle.
 *
 * EVE owns evaluation and fitness measurement for the whole organism. ADAM
 * proposes mutations to its genome; this module measures whether a mutation
 * makes the organism operationally better or worse, by running a
 * construct-validated scenario suite twice at the same seed — once as the
 * organism is, once with the mutation projected onto the operator — and
 * reporting the difference.
 *
 * The three parts, in the order they matter:
 *
 * - {@link project} decides whether a mutation has any measurable operational
 *   consequence, and returns nothing when it does not. A mutation EVE cannot
 *   measure is escalated with that reason, never assigned a fabricated score.
 * - {@link validateMutation} performs the counterfactual measurement and
 *   returns a sealed CP/1 `FitnessResult`.
 * - {@link serve} exposes it over line-delimited JSON on stdio, which is how
 *   ADAM reaches it without either repository depending on the other.
 *
 * @example
 * ```ts
 * import { validateMutation } from "experience-validation-engine/fitness";
 *
 * const result = await validateMutation(request);
 * if (result.recommendation === "approve") {
 *   console.log(`+${result.delta_bp}bp: ${result.reason}`);
 * }
 * ```
 */

export {
  DEFAULT_PANEL,
  DEFAULT_THRESHOLDS,
  type Thresholds,
  type ValidateOptions,
  validateMutation,
} from "./fitness.js";
export {
  applyDeltas,
  explainUnprojectable,
  POLICY_KEYWORDS,
  type Projection,
  project,
  TRAIT_PROJECTIONS,
  type TraitDelta,
} from "./projection.js";
export {
  DEFAULT_SCENARIO_IDS,
  listScenarios,
  registerScenario,
  resolveScenarios,
  type Scenario,
} from "./scenarios.js";
export {
  handleEnvelope,
  type ProtocolError,
  type ServiceOptions,
  serve,
} from "./service.js";
