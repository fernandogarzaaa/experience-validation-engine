import { describe, expect, it } from "vitest";
import {
  type ExperimentSpec,
  renderExperimentJson,
  validateExperimentSpec,
} from "../src/research/index.js";
import { isPairable, pairedRunKey, type RunSpec } from "../src/trace/index.js";

function spec(overrides: Partial<ExperimentSpec> = {}): ExperimentSpec {
  return {
    experimentId: "exp-01",
    taskIds: ["checkout_basic_01"],
    environment: { adapter: "mock" },
    behaviorModelVersion: "1.0.0",
    parameterSetVersion: "1.0.0",
    population: { kind: "balanced", size: 10, seed: 1 },
    variants: [{ name: "control" }, { name: "redesign-b" }],
    seeds: [1, 2, 3],
    datasetSplit: { method: "held-out-users", heldOutFraction: 0.3, seed: 9 },
    ...overrides,
  };
}

describe("RunSpec pairing (Phase 13)", () => {
  const base: RunSpec = {
    operatorId: "op-1",
    taskId: "checkout_basic_01",
    startUrl: "mock:home",
    seed: 7,
    persona: "office-worker",
    behaviorModelVersion: "1.0.0",
    parameterSetVersion: "1.0.0",
  };

  it("pairs variants of one experimental unit", () => {
    const a = { ...base, variant: "control" };
    const b = { ...base, variant: "redesign-b" };
    expect(pairedRunKey(a)).toBe(pairedRunKey(b));
    expect(isPairable(a, b)).toBe(true);
  });

  it("does not pair identical variants or different units", () => {
    expect(isPairable({ ...base, variant: "control" }, { ...base, variant: "control" })).toBe(
      false,
    );
    expect(isPairable(base, { ...base, seed: 8, variant: "x" })).toBe(false);
    expect(isPairable(base, { ...base, taskId: "other", variant: "x" })).toBe(false);
  });

  it("is deterministic", () => {
    expect(pairedRunKey(base)).toBe(pairedRunKey({ ...base }));
  });

  it("distinguishes numeric seed 7 from string seed '7' (CodeRabbit PR #46)", () => {
    // Seed type changes the RNG stream: coercing both to "7" would pair
    // runs that cannot reproduce each other. JSON encoding preserves types.
    expect(pairedRunKey(base)).not.toBe(pairedRunKey({ ...base, seed: "7" }));
  });

  it("never collides across delimiter-bearing components (CodeRabbit PR #46)", () => {
    const a: RunSpec = { ...base, operatorId: "op::1", taskId: "t" };
    const b: RunSpec = { ...base, operatorId: "op", taskId: "1::t" };
    expect(pairedRunKey(a)).not.toBe(pairedRunKey(b));
  });
});

describe("ExperimentSpec manifest (Phase 14)", () => {
  it("accepts a well-formed manifest and round-trips JSON", () => {
    expect(validateExperimentSpec(spec())).toEqual([]);
    expect(JSON.parse(renderExperimentJson(spec()))).toEqual(
      JSON.parse(renderExperimentJson(spec())),
    );
  });

  it("rejects empty ids, tasks, variants, seeds, and bad splits", () => {
    expect(validateExperimentSpec(spec({ experimentId: " " }))).toContain(
      "experimentId must be non-empty.",
    );
    expect(validateExperimentSpec(spec({ taskIds: [] }))).toContain(
      "at least one taskId is required.",
    );
    expect(validateExperimentSpec(spec({ variants: [] }))).toContain(
      "at least one variant is required.",
    );
    expect(validateExperimentSpec(spec({ variants: [{ name: "a" }, { name: "a" }] }))).toContain(
      "variant names must be unique.",
    );
    expect(validateExperimentSpec(spec({ seeds: [] }))).toContain("at least one seed is required.");
    expect(
      validateExperimentSpec(
        spec({ datasetSplit: { method: "random-split", heldOutFraction: 1, seed: 1 } }),
      ),
    ).toContain("datasetSplit.heldOutFraction must be strictly between 0 and 1.");
    expect(
      validateExperimentSpec(
        spec({
          population: { kind: "distribution", size: 5, seed: 1 },
        }),
      ),
    ).toContain("distribution populations require a non-empty distribution.");
  });

  it("rejects non-integer, non-finite, and zero-weight populations (CodeRabbit PR #46)", () => {
    expect(
      validateExperimentSpec(spec({ population: { kind: "balanced", size: 2.5, seed: 1 } })),
    ).toContain("population.size must be an integer (fractional sizes diverge from manifests).");
    expect(
      validateExperimentSpec(spec({ population: { kind: "balanced", size: NaN, seed: 1 } })),
    ).toContain("population.size must be a finite number.");
    expect(
      validateExperimentSpec(
        spec({
          population: {
            kind: "distribution",
            size: 5,
            seed: 1,
            distribution: { segments: [{ weight: 0 }, { weight: 0 }] },
          },
        }),
      ),
    ).toContain("distribution weights must sum to more than 0.");
    expect(
      validateExperimentSpec(
        spec({
          population: { kind: "balanced", size: 5, seed: 1 },
        }),
      ),
    ).toEqual([]);
  });
});
