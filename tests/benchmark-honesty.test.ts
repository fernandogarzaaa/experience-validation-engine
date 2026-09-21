import { describe, expect, it } from "vitest";
import { validateBenchmarks } from "../src/benchmarks/index.js";

describe("benchmark regression semantics (P1.9-audit)", () => {
  it("reports internal discrimination, not human validation", async () => {
    const validation = await validateBenchmarks({
      personas: ["office-worker"],
      seed: 100,
      maxSteps: 40,
    });
    expect(typeof validation.ordered).toBe("boolean");
    expect(validation.summary).toContain("NOT human validation");
    expect(validation.summary).not.toContain("discriminates UX quality");
  }, 120_000);
});
