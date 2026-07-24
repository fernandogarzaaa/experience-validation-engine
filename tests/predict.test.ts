import { describe, it, expect, beforeAll } from "vitest";

import { simulatePopulation, type PopulationStudy } from "../src/population/index.js";
import {
  predictUX,
  wilsonInterval,
  renderUXPredictionMarkdown,
  type UXPrediction,
} from "../src/predict/index.js";
import { runPredictUX } from "../src/mcp/tools.js";
import { RunUsabilityStudySchema } from "../src/mcp/schemas.js";

describe("wilsonInterval", () => {
  it("brackets the point estimate and stays in [0,1]", () => {
    const ci = wilsonInterval(5, 20);
    expect(ci.low).toBeGreaterThanOrEqual(0);
    expect(ci.high).toBeLessThanOrEqual(1);
    expect(ci.low).toBeLessThan(0.25);
    expect(ci.high).toBeGreaterThan(0.25);
  });

  it("narrows as n grows", () => {
    const small = wilsonInterval(5, 10);
    const large = wilsonInterval(50, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("handles the empty and boundary cases", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });
    const allSuccess = wilsonInterval(10, 10);
    expect(allSuccess.high).toBeLessThanOrEqual(1);
    expect(allSuccess.low).toBeLessThan(1);
  });
});

describe("predictUX", () => {
  let study: PopulationStudy;
  let prediction: UXPrediction;
  beforeAll(async () => {
    study = await simulatePopulation({ url: "mock:", size: 16, seed: 7, maxSteps: 25, concurrency: 8 });
    prediction = predictUX(study);
  }, 120_000);

  it("predicts abandonment and confusion with intervals", () => {
    const abandon = prediction.predictions.find((p) => p.metric === "Abandonment rate")!;
    expect(abandon.low).toBeLessThanOrEqual(abandon.estimate);
    expect(abandon.high).toBeGreaterThanOrEqual(abandon.estimate);
    expect(abandon.estimate).toBeCloseTo(study.dropoffRate, 5);
    expect(prediction.predictions.some((p) => p.metric === "Confusion rate")).toBe(true);
  });

  it("models a support-contact rate per 100 users", () => {
    const support = prediction.predictions.find((p) => p.metric === "Support contacts")!;
    expect(support.unit).toBe("per-100-users");
    expect(support.basis).toBe("modeled");
    expect(support.low).toBeLessThan(support.high);
  });

  it("forecasts struggle points sorted by risk", () => {
    const risks = prediction.struggleForecasts.map((s) => s.predictedConfusion);
    expect([...risks].sort((a, b) => b - a)).toEqual(risks);
    for (const s of prediction.struggleForecasts) {
      expect(s.predictedConfusion).toBeGreaterThan(0);
      expect(s.predictedConfusion).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a fixed study", () => {
    expect({ ...predictUX(study), generatedAt: 0 }).toEqual({ ...prediction, generatedAt: 0 });
  });

  it("renders a Markdown prediction report", () => {
    const md = renderUXPredictionMarkdown(prediction);
    expect(md).toContain("Predictive UX");
    expect(md).toContain("95% confidence");
  });
});

describe("mcp eve_predict_ux", () => {
  it("predicts via the MCP tool", async () => {
    const input = RunUsabilityStudySchema.parse({ url: "mock:", size: 8, seed: 1, concurrency: 4, max_steps: 25 });
    const out = await runPredictUX(input);
    expect(out.markdown).toContain("Predictive UX");
    expect((out.structured.predictions as unknown[]).length).toBeGreaterThan(1);
  }, 60_000);
});
