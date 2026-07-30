import { describe, expect, it } from "vitest";
import { BENCHMARK_APPS, validateBenchmarks } from "../src/benchmarks/index.js";
import { MockAdapter } from "../src/browser/index.js";
import { EveSession } from "../src/engine/session.js";
import { forecastExperience } from "../src/forecasting/index.js";
import {
  buildProductPlan,
  critiqueDesign,
  generateTickets,
  moderatePanel,
  runPanel,
  toGitHubIssues,
  toJiraIssues,
  toLinearIssues,
} from "../src/panel/index.js";
import { compareExperience, extractMetrics } from "../src/regression/index.js";

async function run(
  app: (typeof BENCHMARK_APPS)[keyof typeof BENCHMARK_APPS],
  persona: string,
  seed = 5,
) {
  return new EveSession({
    adapter: new MockAdapter(app),
    startUrl: "mock:home",
    persona,
    goal: "create an account and get to the main screen",
    goalSuccessSignals:
      app === BENCHMARK_APPS.excellent
        ? ["all set"]
        : app === BENCHMARK_APPS.average
          ? ["your dashboard"]
          : ["has been created"],
    seed,
    maxSteps: 40,
    paceScale: 0,
  }).run();
}

describe("benchmark suite (construct validity)", () => {
  it("scores excellent > average > bad", async () => {
    const v = await validateBenchmarks({ seed: 100 });
    expect(v.ordered).toBe(true);
    expect(v.results[0]!.meanScore).toBeGreaterThan(v.results[1]!.meanScore);
    expect(v.results[1]!.meanScore).toBeGreaterThan(v.results[2]!.meanScore);
  }, 60_000);
});

describe("experience regression", () => {
  it("flags a degraded build even when the task still completes", async () => {
    const good = await run(BENCHMARK_APPS.excellent, "office-worker");
    const bad = await run(BENCHMARK_APPS.bad, "office-worker");
    // Re-target the bad run's goal signal so both "complete" for a fair
    // experience comparison of the path quality.
    const report = compareExperience(good, bad, { baseline: "v1", candidate: "v2" });
    expect(report.verdict).toBe("regressed");
    expect(report.regressions.length).toBeGreaterThan(0);
    const m = extractMetrics(good);
    expect(m.overallScore).toBeGreaterThan(0);
  }, 60_000);

  it("reports unchanged for identical runs", async () => {
    const a = await run(BENCHMARK_APPS.excellent, "office-worker", 11);
    const b = await run(BENCHMARK_APPS.excellent, "office-worker", 11);
    const report = compareExperience(a, b);
    expect(report.verdict).not.toBe("regressed");
  }, 60_000);
});

describe("AI panel", () => {
  it("produces critique, forecast, consensus, plan and tickets", async () => {
    const sessions = await Promise.all([
      run(BENCHMARK_APPS.bad, "first-time-user"),
      run(BENCHMARK_APPS.bad, "impatient-user"),
      run(BENCHMARK_APPS.bad, "office-worker"),
    ]);
    const panel = runPanel(sessions);
    expect(panel.critique.inspectionScore).toBeGreaterThanOrEqual(0);
    expect(panel.critique.inspectionScore).toBeLessThanOrEqual(100);
    expect(panel.forecast.summary.length).toBeGreaterThan(0);
    expect(panel.executive.personaCount).toBe(3);
    expect(panel.plan.epics.length).toBeGreaterThan(0);
    // Every epic has at least one story → at least one ticket.
    expect(panel.tickets.length).toBeGreaterThanOrEqual(panel.plan.epics.length);

    // Serializers produce the right shapes.
    const gh = toGitHubIssues(panel.tickets);
    expect(gh[0]).toHaveProperty("title");
    expect(gh[0]).toHaveProperty("labels");
    const jira = toJiraIssues(panel.tickets);
    expect(jira[0]).toHaveProperty("issuetype", "Story");
    const linear = toLinearIssues(panel.tickets);
    expect(typeof linear[0]!.priority).toBe("number");
  }, 60_000);

  it("design critic flags issues on a bad app and fewer on a good one", async () => {
    const bad = await run(BENCHMARK_APPS.bad, "office-worker");
    const good = await run(BENCHMARK_APPS.excellent, "office-worker");
    const badCritique = critiqueDesign(bad.capturedScreens, bad.findings);
    const goodCritique = critiqueDesign(good.capturedScreens, good.findings);
    expect(badCritique.inspectionScore).toBeLessThan(goodCritique.inspectionScore);
  }, 60_000);

  it("moderator finds consensus and PM prioritizes", async () => {
    const sessions = await Promise.all([
      run(BENCHMARK_APPS.bad, "first-time-user"),
      run(BENCHMARK_APPS.bad, "anxious-user"),
    ]);
    const forecast = forecastExperience(sessions);
    const exec = moderatePanel({ sessions, forecast });
    expect(exec.meanOverallScore).toBeGreaterThanOrEqual(0);
    const plan = buildProductPlan({ executive: exec, forecast });
    // Epics are sorted by descending priority.
    for (let i = 1; i < plan.epics.length; i++) {
      expect(plan.epics[i - 1]!.priorityScore).toBeGreaterThanOrEqual(plan.epics[i]!.priorityScore);
    }
    const tickets = generateTickets(plan, exec);
    expect(tickets.every((t) => t.acceptanceCriteria.length > 0)).toBe(true);
  }, 60_000);
});
