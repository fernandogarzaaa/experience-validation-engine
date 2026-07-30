import { describe, expect, it } from "vitest";

import { AVERAGE_APP, BAD_APP, EXCELLENT_APP } from "../src/benchmarks/index.js";
import { MockAdapter } from "../src/browser/index.js";
import { CompareBuildsSchema } from "../src/mcp/schemas.js";
import { compareBuilds } from "../src/mcp/tools.js";
import { simulatePopulation } from "../src/population/index.js";
import {
  type BuildSnapshot,
  type TrendMetricKey,
  analyzeTrends,
  metricsFromStudy,
  renderTrendReportMarkdown,
} from "../src/trends/index.js";

function snap(label: string, m: Record<TrendMetricKey, number>): BuildSnapshot {
  return { label, metrics: m };
}

const GOOD: Record<TrendMetricKey, number> = {
  successRate: 0.8,
  dropoffRate: 0.1,
  overallScore: 72,
  confidence: 0.7,
  frustration: 0.2,
  trust: 0.65,
  medianSteps: 16,
};
const BAD: Record<TrendMetricKey, number> = {
  successRate: 0.4,
  dropoffRate: 0.35,
  overallScore: 48,
  confidence: 0.35,
  frustration: 0.6,
  trust: 0.4,
  medianSteps: 34,
};

describe("trend analysis", () => {
  it("flags every metric as improved when the build gets better", () => {
    const report = analyzeTrends([snap("v1", BAD), snap("v2", GOOD)]);
    expect(report.verdict).toBe("improving");
    expect(report.regressions).toHaveLength(0);
    expect(report.improvements.length).toBe(report.trends.length);
    // Direction accounts for higher-is-better vs lower-is-better.
    const dropoff = report.trends.find((t) => t.metric === "dropoffRate")!;
    expect(dropoff.direction).toBe("improved"); // dropoff fell, which is good
    expect(dropoff.higherIsBetter).toBe(false);
  });

  it("flags regressions when the build gets worse", () => {
    const report = analyzeTrends([snap("v1", GOOD), snap("v2", BAD)]);
    expect(report.verdict).toBe("regressing");
    expect(report.improvements).toHaveLength(0);
    expect(report.regressions.length).toBeGreaterThan(0);
  });

  it("reports stable when nothing meaningfully changes", () => {
    const report = analyzeTrends([snap("v1", GOOD), snap("v2", { ...GOOD })]);
    expect(report.verdict).toBe("stable");
  });

  it("computes a slope across three builds", () => {
    const mid: Record<TrendMetricKey, number> = { ...BAD, overallScore: 60, successRate: 0.6 };
    const report = analyzeTrends([snap("v1", BAD), snap("v2", mid), snap("v3", GOOD)]);
    const score = report.trends.find((t) => t.metric === "overallScore")!;
    expect(score.slope).toBeGreaterThan(0);
    expect(score.series).toEqual([48, 60, 72]);
  });

  it("requires at least two builds", () => {
    expect(() => analyzeTrends([snap("only", GOOD)])).toThrow(/at least two/);
  });

  it("renders a Markdown trend report", () => {
    const md = renderTrendReportMarkdown(analyzeTrends([snap("v1", BAD), snap("v2", GOOD)]));
    expect(md).toContain("Continuous UX regression");
    expect(md).toContain("Metric trends");
  });
});

describe("trend analysis over real builds (construct validity)", () => {
  it("sees experience improve from a bad build to an excellent one", async () => {
    const common = {
      url: "mock:home",
      size: 6,
      seed: 5,
      maxSteps: 25,
      concurrency: 8,
      goal: "create an account and get to the main screen",
    } as const;
    const bad = await simulatePopulation({
      ...common,
      goalSuccessSignals: ["has been created"],
      adapterFactory: () => new MockAdapter(BAD_APP),
    });
    const avg = await simulatePopulation({
      ...common,
      goalSuccessSignals: ["your dashboard"],
      adapterFactory: () => new MockAdapter(AVERAGE_APP),
    });
    const good = await simulatePopulation({
      ...common,
      goalSuccessSignals: ["all set"],
      adapterFactory: () => new MockAdapter(EXCELLENT_APP),
    });

    const report = analyzeTrends([
      { label: "bad", study: bad },
      { label: "average", study: avg },
      { label: "excellent", study: good },
    ]);
    const score = report.trends.find((t) => t.metric === "overallScore")!;
    expect(score.direction).toBe("improved");
    expect(metricsFromStudy(good).overallScore).toBeGreaterThan(metricsFromStudy(bad).overallScore);
  }, 120_000);
});

describe("mcp eve_compare_builds", () => {
  it("compares two mock builds via the MCP tool", async () => {
    const input = CompareBuildsSchema.parse({
      builds: [
        { url: "mock:", label: "v1" },
        { url: "mock:", label: "v2" },
      ],
      size: 6,
      seed: 3,
      max_steps: 20,
      concurrency: 6,
    });
    const out = await compareBuilds(input);
    expect(out.markdown).toContain("trend report");
    expect(out.structured.builds).toEqual(["v1", "v2"]);
    // Identical builds → every metric stable.
    expect(out.structured.verdict).toBe("stable");
  }, 90_000);
});
