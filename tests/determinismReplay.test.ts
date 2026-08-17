import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { MockAdapter } from "../src/browser/mock.js";
import { EveSession } from "../src/engine/session.js";
import { validateMutation } from "../src/fitness/fitness.js";
import { listScenarios } from "../src/fitness/scenarios.js";
import { getPersona } from "../src/personas/index.js";
import type { FitnessResult, ValidationRequest } from "../src/protocol/types.js";

/**
 * Deterministic replay.
 *
 * A fitness measurement decides whether a genome mutation is accepted. If the
 * same request can produce two different verdicts, the verdict is not evidence
 * about the mutation — it is partly evidence about how busy this machine was.
 * These tests run one request repeatedly under identical conditions and require
 * byte-identity where determinism is expected.
 *
 * Two layers, because their criteria genuinely differ:
 *
 * - **Trajectory.** Every action, percept, perceived latency, emotion sample and
 *   final state of a single session. Nothing here may vary.
 * - **Measurement.** The measured content of a `FitnessResult`: both arms of the
 *   counterfactual, the delta, the recommendation, the evidence lines.
 *
 * Document ids and `produced_at` are excluded, and the exclusion is deliberate
 * rather than convenient: they identify *this* run, so requiring them to repeat
 * would require a measurement to lie about when it happened. They are written to
 * the report so a reader can see exactly what was allowed to differ.
 */

const RUNS = 3;
const REPORT_PATH = "docs/evidence/determinism-replay.json";
const PRODUCED_AT = "2026-01-01T00:00:00.000Z";

const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The exact mutation from the Phase 0.2 experiment, not a friendlier one. */
const request: ValidationRequest = {
  cp: "cp1",
  type: "ValidationRequest",
  id: "22222222-2222-4222-8222-222222222222",
  mutation: {
    cp: "cp1",
    type: "Mutation",
    id: "11111111-1111-4111-8111-111111111111",
    kind: "amend_genome",
    target: "policies.append",
    proposed_value: "verify records before processing them",
    rationale: "records were processed without being verified",
    confidence_bp: 7000,
    risk_bp: 2000,
    status: "proposed",
    provenance: {
      authored_by: "adam",
      produced_at: PRODUCED_AT,
      origin: "adam:evolution/propose",
      evidence: [],
      derived_from: [],
      content_hash: "",
    },
  },
  genome_before_hash: "genome-before",
  genome_after_hash: "genome-after",
  scenario_ids: [],
  seed: 1337,
  trials: 2,
  provenance: {
    authored_by: "adam",
    produced_at: PRODUCED_AT,
    origin: "adam:eve/validate",
    evidence: [],
    derived_from: [],
    content_hash: "",
  },
};

/** Everything a session did, in the order it did it. */
async function runTrajectory(): Promise<unknown> {
  const scenario = listScenarios()[0];
  const result = await new EveSession({
    adapter: new MockAdapter(scenario.app),
    startUrl: "mock:home",
    persona: getPersona("first-time-user"),
    goal: scenario.goal,
    goalSuccessSignals: [scenario.successSignal],
    seed: "replay-fixed-seed",
    maxSteps: 30,
    cognitive: true,
    deterministic: true,
  }).run();

  return {
    goalAchieved: result.goalAchieved,
    abandoned: result.abandoned,
    abandonReason: result.abandonReason,
    endReason: result.endReason,
    iterations: result.iterations,
    capturedScreens: result.capturedScreens,
    scores: result.scores,
    emotionTimeline: result.emotionTimeline,
    cognitiveLoad: result.cognitiveLoad,
    findings: result.findings,
    usage: result.usage,
  };
}

/**
 * Names the run rather than describing what it measured.
 *
 * `simulation_event_id` points at the `SimulationCompleted` event this result
 * was derived from. A second run is a second event, so the id necessarily
 * differs — for the same reason the document id does. Dropping it is not
 * loosening the check: the line it appears on is a pointer, and everything the
 * pointer leads to is compared in full elsewhere.
 */
const isRunIdentity = (line: string): boolean => line.startsWith("simulation_event_id=");

/** Measured content: what a governance decision would actually rest on. */
const measured = (r: FitnessResult) => ({
  mutation_id: r.mutation_id,
  seed: r.seed,
  scenario_ids: r.scenario_ids,
  trials: r.trials,
  baseline: r.baseline,
  candidate: r.candidate,
  delta_bp: r.delta_bp,
  recommendation: r.recommendation,
  reason: r.reason,
  evidence: r.provenance.evidence.filter((line) => !isRunIdentity(line)),
});

/** Excluded from the identity check, recorded so the exclusion is visible. */
const identity = (r: FitnessResult) => ({
  id: r.id,
  produced_at: r.provenance.produced_at,
  derived_from: r.provenance.derived_from,
  run_identity_evidence: r.provenance.evidence.filter(isRunIdentity),
});

describe("deterministic replay", () => {
  it("replays a trajectory and a measurement byte-identically", async () => {
    const trajectories: string[] = [];
    const measurements: string[] = [];
    const identities: unknown[] = [];
    let first: FitnessResult | null = null;

    for (let run = 0; run < RUNS; run += 1) {
      trajectories.push(sha(await runTrajectory()));
      const result = await validateMutation(request);
      first ??= result;
      measurements.push(sha(measured(result)));
      identities.push(identity(result));
    }

    const distinct = (xs: readonly string[]): number => new Set(xs).size;
    const report = {
      runs: RUNS,
      trajectory: { hashes: trajectories, distinct: distinct(trajectories) },
      measurement: { hashes: measurements, distinct: distinct(measurements) },
      identity_fields_excluded: identities,
      first_measurement: first === null ? null : measured(first),
    };
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    expect(distinct(trajectories)).toBe(1);
    expect(distinct(measurements)).toBe(1);
  }, 300_000);
});
