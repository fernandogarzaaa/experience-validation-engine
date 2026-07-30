import { MockAdapter } from "../browser/mock.js";
import { EveSession } from "../engine/session.js";
import { BENCHMARK_APPS, type BenchmarkTier } from "./apps.js";

/**
 * Benchmark validation harness.
 *
 * Runs EVE against the three known-quality apps with a fixed persona panel
 * and checks that the resulting scores are ordered excellent > average > bad.
 * This is EVE's standing construct-validity test — if a change to the
 * cognitive model breaks the ordering, the instrument has lost discriminative
 * power and the harness fails.
 */

export interface BenchmarkRunResult {
  tier: BenchmarkTier;
  meanScore: number;
  perPersona: Array<{ persona: string; score: number; completed: boolean; abandoned: boolean }>;
}

export interface BenchmarkValidation {
  results: BenchmarkRunResult[];
  ordered: boolean;
  /** Score separation between adjacent tiers (excellent−average, average−bad). */
  separations: { excellentVsAverage: number; averageVsBad: number };
  summary: string;
}

const DEFAULT_PANEL = ["first-time-user", "impatient-user", "office-worker"] as const;

/**
 * The single terminal phrase present on each app's success screen. Each app
 * reaches the same conceptual endpoint (account created), so success is
 * detected identically per tier — only the *path quality* differs.
 */
const TERMINAL_SIGNAL: Record<BenchmarkTier, string> = {
  excellent: "all set",
  average: "your dashboard",
  bad: "has been created",
};

export interface BenchmarkOptions {
  personas?: readonly string[];
  seed?: number;
  maxSteps?: number;
  goal?: string;
  cognitive?: boolean;
}

async function runTier(
  tier: BenchmarkTier,
  options: BenchmarkOptions,
): Promise<BenchmarkRunResult> {
  const personas = options.personas ?? DEFAULT_PANEL;
  const app = BENCHMARK_APPS[tier];
  const perPersona: BenchmarkRunResult["perPersona"] = [];
  for (const persona of personas) {
    const session = new EveSession({
      adapter: new MockAdapter(app),
      startUrl: "mock:home",
      persona,
      goal: options.goal ?? "create an account and get to the main screen",
      goalSuccessSignals: [TERMINAL_SIGNAL[tier]],
      seed: options.seed ?? 100,
      maxSteps: options.maxSteps ?? 40,
      paceScale: 0,
      cognitive: options.cognitive ?? false,
    });
    const r = await session.run();
    perPersona.push({
      persona,
      score: r.scores.find((s) => s.dimension === "overall")?.value ?? 0,
      completed: r.goalAchieved,
      abandoned: r.abandoned,
    });
  }
  const meanScore = Math.round(perPersona.reduce((a, b) => a + b.score, 0) / perPersona.length);
  return { tier, meanScore, perPersona };
}

/** Run all three tiers and validate the ordering. */
export async function validateBenchmarks(
  options: BenchmarkOptions = {},
): Promise<BenchmarkValidation> {
  const excellent = await runTier("excellent", options);
  const average = await runTier("average", options);
  const bad = await runTier("bad", options);
  const results = [excellent, average, bad];

  const ordered = excellent.meanScore > average.meanScore && average.meanScore > bad.meanScore;
  const separations = {
    excellentVsAverage: excellent.meanScore - average.meanScore,
    averageVsBad: average.meanScore - bad.meanScore,
  };
  const summary = ordered
    ? `EVE correctly ranked the benchmarks: excellent ${excellent.meanScore} > average ${average.meanScore} > bad ${bad.meanScore}. The instrument discriminates UX quality.`
    : `Benchmark ordering FAILED: excellent ${excellent.meanScore}, average ${average.meanScore}, bad ${bad.meanScore}. EVE is not discriminating quality as expected.`;

  return { results, ordered, separations, summary };
}
