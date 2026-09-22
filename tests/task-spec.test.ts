import { describe, expect, it } from "vitest";
import type { TaskSpec } from "../src/planning/index.js";
import { matchTaskIds, normalizeTaskId, resolveTaskId } from "../src/planning/index.js";

const SPEC: TaskSpec = {
  taskId: "checkout_basic_01",
  description: "Buy the test item with a card",
  goal: "complete the purchase",
  successSignals: ["order confirmed"],
  startingConditions: { startUrl: "https://shop.test/", persona: "office-worker" },
  bounds: { maxSteps: 40 },
  family: "checkout",
  metadata: { site: "fixture" },
};

describe("TaskSpec (Phase 2)", () => {
  it("normalizes ids for stable cross-run identity", () => {
    expect(normalizeTaskId("Checkout_Basic-01")).toBe("checkout_basic_01");
    expect(normalizeTaskId("  checkout basic 01 ")).toBe("checkout_basic_01");
  });

  it("matches human and EVE task ids after normalization", () => {
    expect(matchTaskIds("Checkout_Basic-01", "checkout_basic_01")).toBe(true);
    expect(matchTaskIds("checkout_basic_01", "checkout_basic_02")).toBe(false);
    expect(matchTaskIds("", "checkout_basic_01")).toBe(false);
  });

  it("resolves explicit id first, then spec, else null (never fabricated)", () => {
    expect(resolveTaskId("custom_1", SPEC)).toBe("custom_1");
    expect(resolveTaskId(undefined, SPEC)).toBe("checkout_basic_01");
    expect(resolveTaskId("  ", SPEC)).toBe("checkout_basic_01");
    expect(resolveTaskId(undefined, undefined)).toBeNull();
  });

  it("serializes deterministically for manifests", () => {
    expect(JSON.stringify(SPEC)).toBe(JSON.stringify({ ...SPEC }));
  });
});
