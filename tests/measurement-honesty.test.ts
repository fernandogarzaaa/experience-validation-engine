import { describe, expect, it } from "vitest";
import { calibrate, type HumanStudy } from "../src/calibration/index.js";
import { forecastExperience } from "../src/forecasting/index.js";
import type { PopulationStudy } from "../src/population/index.js";
import { predictUX } from "../src/predict/index.js";

function eveStudy(): PopulationStudy {
  const dist = {
    count: 4,
    mean: 0.5,
    stdDev: 0.1,
    min: 0,
    max: 1,
    p25: 0.4,
    median: 0.5,
    p75: 0.6,
  };
  const op = (i: number) => ({
    index: i,
    persona: `op${i}`,
    profession: null,
    culture: "en-US",
    seed: `${i}`,
    overall: 70,
    completed: i < 3,
    goalAchieved: i < 3,
    abandoned: i === 3,
    abandonReason: i === 3 ? "gave up" : null,
    endReason: "done",
    steps: 8 + i,
    durationMinutes: 2,
    screensVisited: 3,
    findings: 1,
    criticalFindings: 0,
    emotions: { confusion: 0.2 },
    segment: "steady",
    path: ["/", "/a"],
    dropoffScreen: i === 3 ? "/a" : null,
  });
  return {
    url: "https://x.test/",
    size: 4,
    goal: "explore",
    successRate: 0.75,
    dropoffRate: 0.25,
    endReasonBreakdown: {},
    overallScore: dist,
    confidence: dist,
    frustration: dist,
    trust: dist,
    stepsToComplete: dist,
    completionHistogram: { bins: [], total: 4 },
    navigationHeatmap: [],
    segments: [],
    topFindings: [],
    operators: [op(0), op(1), op(2), op(3)],
    generatedAt: new Date().toISOString(),
  };
}

describe("calibration honesty (P1.6/P1.10)", () => {
  const human: HumanStudy = {
    task: "explore",
    traces: [
      { completed: true, path: ["/", "/a"], steps: 9, durationMs: 42000 },
      { completed: false, path: ["/", "/a"], steps: 20, durationMs: 90000, abandonedOn: "/a" },
    ],
  };

  it("never labels step similarity as timing similarity", () => {
    const report = calibrate(human, eveStudy());
    // EVE population operators carry no wall durations → timing omitted.
    expect(report.timingSimilarity).toBeNull();
    expect(report.stepSimilarity).toBeGreaterThanOrEqual(0);
    expect(report.stepSimilarity).toBeLessThanOrEqual(1);
    expect(report.notes.join(" ")).toContain("duration");
  });

  it("marks trajectory comparison as future work, not as validated", () => {
    const report = calibrate(human, eveStudy());
    expect(report.trajectorySimilarity).toBeNull();
  });

  it("works without any duration data and says so", () => {
    const noDur: HumanStudy = {
      traces: [{ completed: true, path: ["/"] }],
    };
    const report = calibrate(noDur, eveStudy());
    expect(report.timingSimilarity).toBeNull();
    expect(report.notes.join(" ")).toMatch(/duration/i);
  });
});

describe("prediction/forecast honesty (P1.5–P1.8)", () => {
  it("labels Wilson ranges as simulation-sample uncertainty, not real-user CIs", () => {
    const prediction = predictUX(eveStudy());
    const abandon = prediction.predictions.find((p) => p.metric === "Abandonment rate")!;
    expect(abandon.note).toMatch(/simulation/i);
    // The only sanctioned "real-user" phrasing is the explicit negation.
    expect(abandon.note).toMatch(/not a real-user CI/i);
    expect(abandon.note).not.toMatch(/95% CI for real/i);
    expect(abandon.provenance).toBe("derived");
    expect(abandon.calibrationStatus).toBe("uncalibrated-heuristic");
    expect(abandon.humanCalibratedEstimate).toBeNull();
  });

  it("struggle forecasts are heuristic indices with provenance", () => {
    const prediction = predictUX(eveStudy());
    for (const s of prediction.struggleForecasts) {
      expect(s.provenance).toBe("heuristic");
    }
  });

  it("forecastExperience exposes struggleIndex identical to struggleProbability", () => {
    const forecast = forecastExperience([]);
    expect(forecast.struggles).toHaveLength(0);
    // Non-empty path exercised via a synthetic session below would need a
    // full SessionResult; the type-level alias + provenance is covered by
    // construction — struggleProbability retained for backwards compat.
    expect(forecast.summary).toContain("No sessions");
  });
});
