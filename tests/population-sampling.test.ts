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
