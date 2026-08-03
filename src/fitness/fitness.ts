/**
 * Counterfactual fitness measurement — the "Validate inside EVE" step of the
 * developmental lifecycle.
 *
 * ADAM sends a {@link ValidationRequest} naming a mutation, a scenario set and
 * a seed. EVE runs the scenario set twice: once with a baseline operator and
 * once with an operator carrying the mutation's projected trait deltas, using
 * the *same* seed both times. The only difference between the two runs is the
 * mutation, so the difference in outcome is attributable to it.
 *
 * This is what makes the measurement evidence rather than assertion. An
 * absolute score would be uninterpretable — "this mutation scored 72" says
 * nothing without knowing what the organism scored before — and a score
 * produced by the component proposing the change would not be measurement at
 * all.
 *
 * See `protocol/cp1/SPEC.md` section 7.1.
 */

import { randomUUID } from "node:crypto";
import { MockAdapter } from "../browser/index.js";
import { EveSession } from "../engine/session.js";
import { definePersona, getPersona, type Persona } from "../personas/index.js";
import { seal, toBasisPoints } from "../protocol/canonical.js";
import { provenance } from "../protocol/documents.js";
import type {
  FitnessResult,
  Measurement,
  Mutation,
  Recommendation,
  ValidationRequest,
} from "../protocol/types.js";
import { applyDeltas, explainUnprojectable, project } from "./projection.js";
import { DEFAULT_SCENARIO_IDS, resolveScenarios, type Scenario } from "./scenarios.js";

/**
 * The operators a measurement runs. Three personas spanning the range that
 * matters: someone who has never seen the product, someone with no patience,
 * and someone fluent. A mutation that helps one and ruins another should not
 * read as neutral, which a single-persona measurement would make it.
 */
export const DEFAULT_PANEL: readonly string[] = ["first-time-user", "impatient-user", "power-user"];

export interface ValidateOptions {
  /** Personas to measure with. Defaults to {@link DEFAULT_PANEL}. */
  readonly panel?: readonly string[];
  /** Step ceiling per session. Sessions that hit it are treated as failures. */
  readonly maxSteps?: number;
  /** Thresholds governing the recommendation. */
  readonly thresholds?: Partial<Thresholds>;
}

export interface Thresholds {
  /** Composite gain, in basis points, at or above which a mutation is approved. */
  readonly approveDeltaBp: number;
  /** Composite loss at or below which a mutation is rejected. */
  readonly rejectDeltaBp: number;
  /**
   * Risk above which no delta is sufficient on its own. A high-risk mutation
   * that improves the composite still goes to a human, because the scenario
   * suite measures operational competence and not the consequences a risk score
   * is tracking.
   */
  readonly maxAutoApproveRiskBp: number;
  /**
   * Per-scenario regression, in basis points, that blocks approval regardless
   * of the aggregate. A mutation that lifts the mean while destroying one
   * scenario is not an improvement; averaging would hide exactly that.
   */
  readonly maxScenarioRegressionBp: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  approveDeltaBp: 100,
  rejectDeltaBp: -100,
  maxAutoApproveRiskBp: 6000,
  maxScenarioRegressionBp: 300,
};

/** One scenario's composite under one operator configuration. */
interface ScenarioScore {
  readonly scenarioId: string;
  readonly composite: number;
  readonly taskSuccess: number;
  readonly frustration: number;
  readonly trust: number;
  readonly cognitiveLoad: number;
  readonly runs: number;
}

const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Measure a mutation and return a sealed CP/1 {@link FitnessResult}.
 *
 * @throws if the request names an unknown scenario, or names no scenario at all
 * after defaults are applied — both mean the caller asked for a measurement
 * that cannot be performed, and returning a result anyway would misrepresent
 * what was measured.
 */
export async function validateMutation(
  request: ValidationRequest,
  options: ValidateOptions = {},
): Promise<FitnessResult> {
  const scenarioIds = request.scenario_ids.length > 0 ? request.scenario_ids : DEFAULT_SCENARIO_IDS;
  const scenarios = resolveScenarios(scenarioIds);
  const panel = options.panel ?? DEFAULT_PANEL;
  const maxSteps = options.maxSteps ?? 40;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  // Defence in depth: the service boundary already enforces the schema's
  // [1, 64] bound, but `validateMutation` is also callable directly.
  const trials = Math.min(64, Math.max(1, Math.trunc(request.trials)));

  const projection = project(request.mutation);

  // A mutation with no operational signature is escalated, not scored. See the
  // projection module's header for why this matters more than it looks.
  if (!projection) {
    return unmeasurable(request, scenarioIds, trials, explainUnprojectable(request.mutation));
  }

  const basePersonas = panel.map((name) => getPersona(name));
  const candidatePersonas = basePersonas.map((persona) =>
    definePersona({
      name: `${persona.name}+${request.mutation.id.slice(0, 8)}`,
      description: `${persona.description} (with mutation ${request.mutation.target})`,
      traits: applyDeltas(persona.traits, projection.deltas),
      accessibility: persona.accessibility,
      disposition: persona.disposition,
    }),
  );

  const baselineScores: ScenarioScore[] = [];
  const candidateScores: ScenarioScore[] = [];
  for (const scenario of scenarios) {
    baselineScores.push(
      await scoreScenario(scenario, basePersonas, request.seed, trials, maxSteps),
    );
    candidateScores.push(
      await scoreScenario(scenario, candidatePersonas, request.seed, trials, maxSteps),
    );
  }

  const baseline = aggregate(baselineScores);
  const candidate = aggregate(candidateScores);
  const deltaBp = candidate.composite_bp - baseline.composite_bp;

  const worstRegression = Math.min(
    0,
    ...candidateScores.map(
      (score, i) =>
        toBasisPoints(score.composite) -
        toBasisPoints((baselineScores[i] as ScenarioScore).composite),
    ),
  );

  const { recommendation, reason } = recommend({
    deltaBp,
    worstRegressionBp: worstRegression,
    mutation: request.mutation,
    thresholds,
    scenarioIds,
    trials,
    panelSize: panel.length,
    explanation: projection.explanation,
  });

  return build({
    request,
    scenarioIds,
    trials,
    baseline,
    candidate,
    deltaBp,
    recommendation,
    reason,
    evidence: [
      `seed=${request.seed}`,
      `scenarios=${scenarioIds.join(",")}`,
      `trials=${trials}`,
      `panel=${panel.join(",")}`,
      `projection=${projection.explanation}`,
      ...candidateScores.map(
        (score, i) =>
          `${score.scenarioId}: ${(baselineScores[i] as ScenarioScore).composite.toFixed(3)} → ${score.composite.toFixed(3)}`,
      ),
    ],
  });
}

/**
 * Run one scenario `trials` times per persona and average.
 *
 * The seed for each run is derived from the request seed, the scenario, the
 * persona index and the trial index, so every run is reproducible and no two
 * runs share a stream. Reusing one seed across runs would make the trials
 * identical and the average meaningless.
 */
async function scoreScenario(
  scenario: Scenario,
  personas: readonly Persona[],
  seed: number,
  trials: number,
  maxSteps: number,
): Promise<ScenarioScore> {
  const successes: number[] = [];
  const overalls: number[] = [];
  const frustrations: number[] = [];
  const trusts: number[] = [];
  const loads: number[] = [];

  for (const [personaIndex, persona] of personas.entries()) {
    for (let trial = 0; trial < trials; trial += 1) {
      const result = await new EveSession({
        adapter: new MockAdapter(scenario.app),
        startUrl: "mock:home",
        persona,
        goal: scenario.goal,
        goalSuccessSignals: [scenario.successSignal],
        seed: `${seed}#${scenario.id}#${personaIndex}#${trial}`,
        maxSteps,
        cognitive: true,
      }).run();

      successes.push(result.goalAchieved ? 1 : 0);
      overalls.push(result.scores.find((s) => s.dimension === "overall")?.value ?? 0);
      const emotion = result.emotionTimeline.at(-1)?.values;
      frustrations.push(emotion?.frustration ?? 0);
      trusts.push(emotion?.trust ?? 0.5);
      loads.push(result.cognitiveLoad?.meanIndex ?? 0);
    }
  }

  const taskSuccess = mean(successes);
  const overall = mean(overalls);
  const frustration = mean(frustrations);
  const trust = mean(trusts);
  const cognitiveLoad = mean(loads);

  // Weighted, higher-is-better, with frustration and load inverted. The weights
  // match the EVE Bench composite so a fitness measurement and a bench score
  // are on the same scale — a delta here is directly comparable to the gap
  // between two reference apps, which is what gives it magnitude as well as
  // sign.
  const composite = clamp01(
    taskSuccess * 0.4 +
      (overall / 100) * 0.3 +
      (1 - clamp01(frustration)) * 0.15 +
      clamp01(trust) * 0.1 +
      (1 - clamp01(cognitiveLoad / 100)) * 0.05,
  );

  return {
    scenarioId: scenario.id,
    composite,
    taskSuccess,
    frustration,
    trust,
    cognitiveLoad: cognitiveLoad / 100,
    runs: successes.length,
  };
}

function aggregate(scores: readonly ScenarioScore[]): Measurement {
  return {
    composite_bp: toBasisPoints(mean(scores.map((s) => s.composite))),
    task_success_bp: toBasisPoints(mean(scores.map((s) => s.taskSuccess))),
    frustration_bp: toBasisPoints(mean(scores.map((s) => s.frustration))),
    trust_bp: toBasisPoints(mean(scores.map((s) => s.trust))),
    cognitive_load_bp: toBasisPoints(mean(scores.map((s) => s.cognitiveLoad))),
    runs: scores.reduce((total, s) => total + s.runs, 0),
  };
}

function recommend(input: {
  deltaBp: number;
  worstRegressionBp: number;
  mutation: Mutation;
  thresholds: Thresholds;
  scenarioIds: readonly string[];
  trials: number;
  panelSize: number;
  explanation: string;
}): { recommendation: Recommendation; reason: string } {
  const { deltaBp, worstRegressionBp, mutation, thresholds } = input;
  const runs = input.scenarioIds.length * input.trials * input.panelSize;
  const context = `over ${runs} seeded runs across ${input.scenarioIds.length} scenario(s); ${input.explanation}`;

  if (deltaBp <= thresholds.rejectDeltaBp) {
    return {
      recommendation: "reject",
      reason: `candidate regressed the composite by ${-deltaBp}bp ${context}`,
    };
  }

  if (deltaBp < thresholds.approveDeltaBp) {
    return {
      recommendation: "needs_review",
      reason:
        `candidate moved the composite by ${deltaBp}bp, inside the noise band ` +
        `[${thresholds.rejectDeltaBp}, ${thresholds.approveDeltaBp})bp ${context}`,
    };
  }

  // Past here the aggregate improved enough to approve on. Two things can still
  // stop it.
  if (worstRegressionBp < -thresholds.maxScenarioRegressionBp) {
    return {
      recommendation: "needs_review",
      reason:
        `candidate improved the composite by ${deltaBp}bp but regressed one scenario by ` +
        `${-worstRegressionBp}bp, past the ${thresholds.maxScenarioRegressionBp}bp limit ${context}`,
    };
  }

  if (mutation.risk_bp > input.thresholds.maxAutoApproveRiskBp) {
    return {
      recommendation: "needs_review",
      reason:
        `candidate improved the composite by ${deltaBp}bp, but the mutation carries ` +
        `${mutation.risk_bp}bp intrinsic risk, above the ${input.thresholds.maxAutoApproveRiskBp}bp ` +
        `ceiling for automatic approval ${context}`,
    };
  }

  return {
    recommendation: "approve",
    reason: `candidate improved the composite by ${deltaBp}bp with no scenario regressing ${context}`,
  };
}

/** A result for a mutation the simulation could not measure. */
function unmeasurable(
  request: ValidationRequest,
  scenarioIds: readonly string[],
  trials: number,
  reason: string,
): FitnessResult {
  // Both sides are zero and identical: nothing was run, and reporting anything
  // else would imply a measurement took place. `runs` is 1 rather than 0 only
  // because the schema floors it at 1 — the evidence line below records
  // `runs=0`, which is the truth, and the two must be read together.
  const nothing: Measurement = {
    composite_bp: 0,
    task_success_bp: 0,
    frustration_bp: 0,
    trust_bp: 0,
    cognitive_load_bp: 0,
    runs: 1,
  };
  return build({
    request,
    scenarioIds,
    trials,
    baseline: nothing,
    candidate: nothing,
    deltaBp: 0,
    recommendation: "needs_review",
    reason: `not measurable by simulation: ${reason}`,
    evidence: [`seed=${request.seed}`, "runs=0", `mutation_kind=${request.mutation.kind}`],
  });
}

function build(input: {
  request: ValidationRequest;
  scenarioIds: readonly string[];
  trials: number;
  baseline: Measurement;
  candidate: Measurement;
  deltaBp: number;
  recommendation: Recommendation;
  reason: string;
  evidence: readonly string[];
}): FitnessResult {
  const document: FitnessResult = {
    cp: "cp1",
    type: "FitnessResult",
    id: randomUUID(),
    mutation_id: input.request.mutation.id,
    seed: input.request.seed,
    scenario_ids: [...input.scenarioIds],
    trials: input.trials,
    baseline: input.baseline,
    candidate: input.candidate,
    // The plain difference, bounded. Both composites are already basis points
    // in [0, 10000], so their difference is in [-10000, 10000] by construction;
    // round-tripping it through `toSignedBasisPoints` would divide and
    // re-multiply for no gain and would clamp anything unexpected to a
    // plausible-looking value instead of preserving it.
    delta_bp: Math.max(-10000, Math.min(10000, input.deltaBp)),
    recommendation: input.recommendation,
    reason: input.reason,
    provenance: provenance({
      origin: "eve:cp1/validate",
      evidence: input.evidence,
      derivedFrom: [input.request.mutation.id],
    }),
  };
  return seal(document as unknown as Record<string, unknown>) as unknown as FitnessResult;
}
