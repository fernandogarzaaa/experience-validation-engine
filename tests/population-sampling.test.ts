import { describe, expect, it } from "vitest";
import { sampleDistribution, sampleOperators } from "../src/population/index.js";

describe("population sampling semantics (Phase 10)", () => {
  it("round-robin BalancedPanel is unchanged by default", () => {
    const specs = sampleOperators({ url: "mock:", size: 6, seed: 1 });
    expect(specs.map((s) => s.seed)).toEqual(["1#0", "1#1", "1#2", "1#3", "1#4", "1#5"]);
    // Seeds use the legacy `#i` scheme (weighted rosters use `#weighted-i`).
    expect(specs.every((s) => !s.seed.includes("weighted"))).toBe(true);
  });

  it("weighted distribution sampling is deterministic", () => {
    const dist = {
      segments: [
        { persona: "office-worker", weight: 0.7 },
        { persona: "power-user", weight: 0.3 },
      ],
    };
    const a = sampleDistribution(dist, 50, "s");
    const b = sampleDistribution(dist, 50, "s");
    expect(a).toEqual(b);
    const office = a.filter((s) => s.persona === "office-worker").length;
    // 0.7 weight over 50 seeded draws lands near 35 (wide tolerance:
    // determinism is the invariant, exact proportion is one realization).
    expect(office).toBeGreaterThan(20);
    expect(office).toBeLessThan(50);
    expect(a.every((s) => s.seed.includes("#weighted-"))).toBe(true);
  });

  it("simulatePopulation accepts a distribution (coverage, not full runs)", () => {
    const specs = sampleOperators({
      url: "mock:",
      size: 10,
      seed: 2,
      distribution: {
        segments: [{ persona: "office-worker", weight: 1 }],
      },
    });
    expect(specs).toHaveLength(10);
    expect(specs.every((s) => s.persona === "office-worker")).toBe(true);
  });

  it("rejects empty, negative, and all-zero weights", () => {
    expect(() => sampleDistribution({ segments: [] }, 5, 1)).toThrow(/at least one/);
    expect(() => sampleDistribution({ segments: [{ weight: -1 }] }, 5, 1)).toThrow(/>= 0/);
    expect(() => sampleDistribution({ segments: [{ weight: 0 }, { weight: 0 }] }, 5, 1)).toThrow(
      /more than 0/,
    );
  });

  it("rejects non-finite weights instead of biasing draws (CodeRabbit PR #46)", () => {
    // Infinity/Infinity is NaN: without the guard every draw silently
    // lands on the final segment.
    expect(() => sampleDistribution({ segments: [{ weight: Infinity }] }, 5, 1)).toThrow(/finite/);
    expect(() => sampleDistribution({ segments: [{ weight: 1 }, { weight: NaN }] }, 5, 1)).toThrow(
      /finite/,
    );
  });

  it("rejects non-finite sizes instead of yielding zero operators (CodeRabbit PR #46)", () => {
    expect(() => sampleDistribution({ segments: [{ weight: 1 }] }, NaN, 1)).toThrow(/finite/);
    expect(() => sampleOperators({ url: "mock:", size: NaN, seed: 1 })).toThrow(/finite/);
  });

  it("falls back to caller pools for segment-missing profession/culture (CodeRabbit PR #46)", () => {
    const specs = sampleDistribution(
      { segments: [{ persona: "office-worker", weight: 1 }] },
      4,
      7,
      undefined,
      ["accountant", "designer"],
      ["en-US", "de-DE"],
    );
    expect(specs.map((s) => s.profession)).toEqual([
      "accountant",
      "designer",
      "accountant",
      "designer",
    ]);
    expect(specs.map((s) => s.culture)).toEqual(["en-US", "de-DE", "en-US", "de-DE"]);
  });

  it("prefers segment values over fallback pools", () => {
    const specs = sampleDistribution(
      { segments: [{ persona: "power-user", profession: "ceo", weight: 1 }] },
      2,
      7,
      undefined,
      ["accountant"],
      ["de-DE"],
    );
    expect(specs.every((s) => s.persona === "power-user")).toBe(true);
    expect(specs.every((s) => s.profession === "ceo")).toBe(true);
    expect(specs.every((s) => s.culture === "de-DE")).toBe(true);
  });

  it("floors size at 1 and honors segment profession/culture", () => {
    const specs = sampleDistribution(
      { segments: [{ persona: "office-worker", profession: "accountant", weight: 1 }] },
      0,
      1,
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.profession).toBe("accountant");
  });
});
