/**
 * EVE Bench — a formal benchmark platform. Where `validateBenchmarks` checks a
 * single construct-validity property (excellent > average > bad on the overall
 * score), EVE Bench runs a defined suite of reference apps through the full
 * cognitive simulation and publishes a multi-dimensional scorecard: task
 * success, overall experience, frustration, trust, cognitive load, expectation
 * alignment, and learnability.
 */

import { EveSession } from "../engine/session.js";
import { MockAdapter, type MockAppSpec } from "../browser/index.js";
import { BENCHMARK_APPS, type BenchmarkTier } from "../benchmarks/index.js";
import { InMemoryStore } from "../memory/index.js";

const TERMINAL_SIGNAL: Record<BenchmarkTier, string> = {
  excellent: "all set",
  average: "your dashboard",
  bad: "has been created",
};

const DEFAULT_PANEL = ["first-time-user", "impatient-user", "power-user"];
const DEFAULT_GOAL = "create an account and get to the main screen";

export interface BenchmarkCase {
  readonly id: string;
  readonly tier: BenchmarkTier;
  readonly app: MockAppSpec;
  readonly goal: string;
  readonly successSignal: string;
}

/** The default EVE Bench suite: the three known-quality reference apps. */
export const EVEBENCH_CASES: readonly BenchmarkCase[] = (
  Object.keys(BENCHMARK_APPS) as BenchmarkTier[]
).map((tier) => ({
  id: tier,
  tier,
  app: BENCHMARK_APPS[tier],
  goal: DEFAULT_GOAL,
  successSignal: TERMINAL_SIGNAL[tier],
}));

export interface CaseScore {
  readonly id: string;
  readonly tier: BenchmarkTier;
  readonly taskSuccess: number;
  readonly overallScore: number;
  readonly frustration: number;
  readonly trust: number;
  readonly cognitiveLoad: number;
  readonly expectationAlignment: number;
  readonly learnability: number;
  /** Composite EVE Bench score, 0..100. */
  readonly composite: number;
}

export interface EveBenchReport {
  readonly cases: readonly CaseScore[];
  /** Mean composite across cases. */
  readonly overall: number;
  /** True when composites rank excellent > average > bad (construct validity). */
  readonly ordered: boolean;
  readonly summary: string;
  readonly generatedAt: string;
}

export interface EveBenchOptions {
  readonly cases?: readonly BenchmarkCase[];
  readonly panel?: readonly string[];
  readonly seed?: number | string;
  readonly maxSteps?: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round = (v: number, p = 3): number => Math.round(v * 10 ** p) / 10 ** p;
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function scoreCase(bench: BenchmarkCase, panel: readonly string[], seed: number | string, maxSteps: number): Promise<CaseScore> {
  const successes: number[] = [];
  const overalls: number[] = [];
  const frustrations: number[] = [];
  const trusts: number[] = [];
  const loads: number[] = [];
  const alignments: number[] = [];

  for (const [i, persona] of panel.entries()) {
    const result = await new EveSession({
      adapter: new MockAdapter(bench.app),
      startUrl: "mock:home",
      persona,
      goal: bench.goal,
      goalSuccessSignals: [bench.successSignal],
      seed: `${seed}#${i}`,
      maxSteps,
      cognitive: true,
    }).run();

    successes.push(result.goalAchieved ? 1 : 0);
    overalls.push(result.scores.find((s) => s.dimension === "overall")?.value ?? 0);
    const emotion = result.emotionTimeline.at(-1)?.values;
    frustrations.push(emotion?.frustration ?? 0);
    trusts.push(emotion?.trust ?? 0.5);
    loads.push(result.cognitiveLoad?.meanIndex ?? 0);
    const exp = result.expectationTimeline ?? [];
    if (exp.length) alignments.push(mean(exp.map((e) => e.matchScore)));
  }

  // Learnability: the same operator, twice on the same app, sharing memory —
  // fewer steps the second time means the app is learnable.
  const store = new InMemoryStore();
  const learnPersona = panel[panel.length - 1] ?? "power-user";
  const run1 = await new EveSession({
    adapter: new MockAdapter(bench.app), startUrl: "mock:home", persona: learnPersona,
    goal: bench.goal, goalSuccessSignals: [bench.successSignal], seed: `${seed}-learn`, maxSteps, longTermMemory: store,
  }).run();
  const run2 = await new EveSession({
    adapter: new MockAdapter(bench.app), startUrl: "mock:home", persona: learnPersona,
    goal: bench.goal, goalSuccessSignals: [bench.successSignal], seed: `${seed}-learn`, maxSteps, longTermMemory: store,
  }).run();
  const learnability = run1.usage.steps > 0 ? clamp01(1 - run2.usage.steps / run1.usage.steps) : 0;

  const taskSuccess = round(mean(successes));
  const overallScore = Math.round(mean(overalls));
  const frustration = round(mean(frustrations));
  const trust = round(mean(trusts));
  const cognitiveLoad = Math.round(mean(loads));
  const expectationAlignment = round(mean(alignments));

  // Composite: weighted, higher-is-better (frustration and load inverted).
  const composite = Math.round(
    taskSuccess * 30 +
      (overallScore / 100) * 25 +
      (1 - frustration) * 15 +
      trust * 10 +
      (1 - cognitiveLoad / 100) * 10 +
      expectationAlignment * 5 +
      learnability * 5,
  );

  return {
    id: bench.id,
    tier: bench.tier,
    taskSuccess,
    overallScore,
    frustration,
    trust,
    cognitiveLoad,
    expectationAlignment,
    learnability: round(learnability),
    composite,
  };
}

/** Run the EVE Bench suite and publish a multi-dimensional scorecard. */
export async function runEveBench(options: EveBenchOptions = {}): Promise<EveBenchReport> {
  const cases = options.cases ?? EVEBENCH_CASES;
  const panel = options.panel ?? DEFAULT_PANEL;
  const seed = options.seed ?? 7;
  const maxSteps = options.maxSteps ?? 40;

  const scores: CaseScore[] = [];
  for (const bench of cases) scores.push(await scoreCase(bench, panel, seed, maxSteps));

  const overall = Math.round(mean(scores.map((s) => s.composite)));
  const excellent = scores.find((s) => s.tier === "excellent")?.composite;
  const average = scores.find((s) => s.tier === "average")?.composite;
  const bad = scores.find((s) => s.tier === "bad")?.composite;
  const ordered =
    excellent !== undefined && average !== undefined && bad !== undefined
      ? excellent > average && average > bad
      : true;

  return {
    cases: scores,
    overall,
    ordered,
    summary:
      `EVE Bench overall ${overall}/100 across ${scores.length} cases. ` +
      (ordered ? "Construct validity holds (excellent > average > bad)." : "⚠️ Construct validity FAILED — the instrument is miscalibrated."),
    generatedAt: new Date().toISOString(),
  };
}
