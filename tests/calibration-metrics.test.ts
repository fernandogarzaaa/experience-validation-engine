import { describe, expect, it } from "vitest";
import {
  brierScore,
  meanLogDurationError,
  spearmanRankCorrelation,
  topKAgreement,
  transitionDivergenceL1,
} from "../src/calibration/index.js";

describe("metric primitives (Phase 11)", () => {
  it("topKAgreement counts human choices inside EVE top-k", () => {
    expect(topKAgreement(["a", "b", "c"], [["a", "x"], ["y", "b"], ["z"]])).toBeCloseTo(2 / 3, 10);
    expect(topKAgreement([], [[]])).toBe(0);
    expect(topKAgreement(["a"], [])).toBe(0);
  });

  it("brierScore matches hand computation", () => {
    // (0.8-1)^2 + (0.2-0)^2 + (0.5-1)^2 = 0.04+0.04+0.25 = 0.33/3 = 0.11
    expect(brierScore([0.8, 0.2, 0.5], [1, 0, 1])).toBeCloseTo(0.11, 10);
    expect(Number.isNaN(brierScore([], []))).toBe(true);
    expect(Number.isNaN(brierScore([0.5], [1, 0]))).toBe(true);
  });

  it("spearman compares orderings, null when undefined", () => {
    expect(spearmanRankCorrelation([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 10);
    expect(spearmanRankCorrelation([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 10);
    expect(spearmanRankCorrelation([1], [2])).toBeNull();
    expect(spearmanRankCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
    expect(spearmanRankCorrelation([1, 2], [1])).toBeNull();
  });

  it("transitionDivergenceL1 spans identical to disjoint", () => {
    const a = new Map([
      ["x>y", 3],
      ["y>z", 1],
    ]);
    expect(transitionDivergenceL1(a, new Map(a))).toBe(0);
    expect(transitionDivergenceL1(new Map(), new Map())).toBe(0);
    expect(transitionDivergenceL1(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(2);
    // Half mass moved: |1-0.5| + |0-0.5| = 1.
    expect(
      transitionDivergenceL1(
        new Map([["a", 2]]),
        new Map([
          ["a", 1],
          ["b", 1],
        ]),
      ),
    ).toBe(1);
  });

  it("meanLogDurationError uses log scale and skips non-positive data", () => {
    // |ln(10)-ln(10)|=0, |ln(100)-ln(10)|=ln10 → mean ln10/2.
    expect(meanLogDurationError([10, 100], [10, 10])).toBeCloseTo(Math.log(10) / 2, 10);
    expect(meanLogDurationError([0, -5], [10, 10])).toBeNull();
    expect(meanLogDurationError([10], [10, 20])).toBeNull();
  });
});
