/**
 * The scenario suite a mutation is measured against.
 *
 * EVE owns benchmark scenarios, and the three reference apps in
 * `benchmarks/apps.ts` are the instrument: they implement the same task at
 * three deliberately different quality levels, and `validateBenchmarks` asserts
 * EVE scores them in strict order. That construct validity is what makes a
 * fitness delta mean anything — an instrument that cannot separate a good app
 * from a bad one cannot detect that a mutation made an operator worse.
 *
 * A fitness measurement therefore reuses the validated instrument rather than
 * inventing scenarios for the purpose. Registering a scenario is possible (see
 * {@link registerScenario}) and is how a deployment measures mutations against
 * its own product, but the built-in three are the calibrated default.
 */

import { BENCHMARK_APPS, type BenchmarkTier } from "../benchmarks/index.js";
import type { MockAppSpec } from "../browser/index.js";

export interface Scenario {
  readonly id: string;
  /** The environment an operator is dropped into. */
  readonly app: MockAppSpec;
  /** What the operator is trying to achieve. */
  readonly goal: string;
  /** Perceiving this text means the goal was reached. */
  readonly successSignal: string;
}

/** Terminal signal per reference app, mirroring the EVE Bench suite. */
const TERMINAL_SIGNAL: Readonly<Record<BenchmarkTier, string>> = {
  excellent: "all set",
  average: "your dashboard",
  bad: "has been created",
};

const DEFAULT_GOAL = "create an account and get to the main screen";

const registry = new Map<string, Scenario>(
  (Object.keys(BENCHMARK_APPS) as BenchmarkTier[]).map((tier) => [
    tier,
    {
      id: tier,
      app: BENCHMARK_APPS[tier],
      goal: DEFAULT_GOAL,
      successSignal: TERMINAL_SIGNAL[tier],
    },
  ]),
);

/** The scenario ids measured when a request names none. */
export const DEFAULT_SCENARIO_IDS: readonly string[] = ["excellent", "average", "bad"];

/**
 * Register a scenario, making it addressable by id in a `ValidationRequest`.
 *
 * Replacing a built-in id is permitted and is how a deployment substitutes its
 * own product for a reference app. It is also how construct validity gets lost,
 * so callers that do it should run `validateBenchmarks` against their own suite.
 */
export function registerScenario(scenario: Scenario): void {
  registry.set(scenario.id, scenario);
}

export function listScenarios(): readonly Scenario[] {
  return [...registry.values()];
}

/**
 * Resolve scenario ids, failing on the first unknown one.
 *
 * Skipping unknown ids would silently measure a mutation against fewer
 * scenarios than were asked for, and report the result as though the full suite
 * had run.
 */
export function resolveScenarios(ids: readonly string[]): readonly Scenario[] {
  return ids.map((id) => {
    const scenario = registry.get(id);
    if (!scenario) {
      throw new Error(
        `unknown scenario "${id}"; registered scenarios are ${[...registry.keys()].join(", ")}`,
      );
    }
    return scenario;
  });
}
