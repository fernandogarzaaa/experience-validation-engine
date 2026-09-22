import { describe, expect, it } from "vitest";
import {
  alignTraces,
  type EveAlignStep,
  type HumanStep,
  importHumanSteps,
} from "../src/calibration/index.js";

function eve(
  index: number,
  stableKey: string,
  actionKind: EveAlignStep["actionKind"] = "click",
  label = `do ${index}`,
): EveAlignStep {
  return { index, stableKey, url: `https://x.test/${stableKey}`, actionKind, actionLabel: label };
}

function human(index: number, stableKey: string, extra: Partial<HumanStep> = {}): HumanStep {
  return {
    index,
    state: {
      kind: "human",
      taskId: null,
      url: null,
      eveStableKey: stableKey,
      provenance: "human-report",
    },
    ...extra,
  };
}

describe("TraceAlignment (Phase 8)", () => {
  it("aligns identical trajectories one-to-one on stable state", () => {
    const e = [eve(0, "s0"), eve(1, "s1"), eve(2, "s2")];
    const h = [human(0, "s0"), human(1, "s1"), human(2, "s2")];
    const a = alignTraces(h, e);
    expect(a.pairs).toHaveLength(3);
    expect(a.pairs.every((p) => p.basis === "stable")).toBe(true);
    expect(a.unmatchedHuman).toHaveLength(0);
    expect(a.unmatchedEve).toHaveLength(0);
    expect(a.coverage).toEqual({ humanMatched: 3, humanTotal: 3, eveMatched: 3, eveTotal: 3 });
  });

  it("refuses crossing matches: monotonicity over greedy reuse", () => {
    const e = [eve(0, "s0"), eve(1, "s1"), eve(2, "s2")];
    const h = [human(0, "s1"), human(1, "s0")];
    const a = alignTraces(h, e);
    // h0→e1 consumes the frontier; h1's s0 lies behind it, so h1 can only
    // pair FORWARD (order fallback to e2), never back to e0. Backtracking
    // surfaces as forward fallback, never as a crossing pair.
    expect(a.pairs).toEqual([
      { humanIndex: 0, eveIndex: 1, basis: "stable" },
      { humanIndex: 1, eveIndex: 2, basis: "order" },
    ]);
    expect(a.unmatchedHuman).toEqual([]);
    expect(a.unmatchedEve).toEqual([0]);
  });

  it("reports missing and extra states explicitly", () => {
    const e = [eve(0, "s0"), eve(1, "s1")];
    const h = [human(0, "s0"), human(1, "ghost")];
    const a = alignTraces(h, e);
    // "ghost" has no state/action match → order fallback pairs it with s1.
    expect(a.pairs).toHaveLength(2);
    expect(a.pairs[1]!.basis).toBe("order");
    expect(a.unmatchedHuman).toHaveLength(0);
  });

  it("leaves truly unmatched actions recorded when EVE is exhausted", () => {
    const e = [eve(0, "s0")];
    const h = [human(0, "s0"), human(1, "s1"), human(2, "s2")];
    const a = alignTraces(h, e);
    // h0→e0 (stable); h1→order fallback finds nothing left after e0 used...
    // e0 is consumed, so h1 and h2 are unmatched.
    expect(a.unmatchedHuman).toEqual([1, 2]);
    expect(a.coverage.humanMatched).toBe(1);
  });

  it("falls back to action semantics before order", () => {
    const e = [eve(0, "s0", "click", "Save"), eve(1, "s9", "click", "Other")];
    const h: HumanStep[] = [{ index: 0, actionKind: "click", actionLabel: "other thing" }];
    const a = alignTraces(h, e);
    expect(a.pairs[0]!.basis).toBe("action-kind");
  });

  it("refuses every level on task disagreement (different experiments)", () => {
    const e = [{ ...eve(0, "s0"), taskId: "task_a" }];
    const h = [{ ...human(0, "s0"), taskId: "task_b" }];
    const a = alignTraces(h, e);
    // Not even the order fallback may pair across conflicting tasks.
    expect(a.pairs).toHaveLength(0);
    expect(a.unmatchedHuman).toEqual([0]);
    expect(a.unmatchedEve).toEqual([0]);
  });

  it("aligns terminal abandonment steps", () => {
    const e = [eve(0, "s0"), { ...eve(1, "s1"), actionKind: "abandon" as const }];
    const h = [human(0, "s0"), { ...human(1, "s1"), abandoned: true }];
    const a = alignTraces(h, e);
    expect(a.pairs).toHaveLength(2);
  });

  it("is deterministic", () => {
    const e = [eve(0, "s0"), eve(1, "s1")];
    const h = [human(1, "s1"), human(0, "s0")];
    expect(JSON.stringify(alignTraces(h, e))).toBe(JSON.stringify(alignTraces(h, e)));
  });

  it("honors task ids nested inside human state", () => {
    const e = [{ ...eve(0, "s0"), taskId: "checkout_basic_01" }];
    const h: HumanStep[] = [
      {
        index: 0,
        state: {
          kind: "human",
          taskId: "checkout_basic_01",
          url: null,
          eveStableKey: "s0",
          provenance: "human-report",
        },
      },
    ];
    const a = alignTraces(h, e);
    expect(a.pairs).toEqual([{ humanIndex: 0, eveIndex: 0, basis: "task+stable" }]);
  });

  it("documents method and limitations on every result", () => {
    const a = alignTraces([], []);
    expect(a.method).toBeTruthy();
    expect(a.limitations.length).toBeGreaterThan(0);
    expect(a.coverage).toEqual({ humanMatched: 0, humanTotal: 0, eveMatched: 0, eveTotal: 0 });
  });
});

describe("importHumanSteps", () => {
  it("validates and normalizes per-step detail", () => {
    const steps = importHumanSteps([
      { actionKind: "click", actionLabel: "Save", durationMs: 1200, taskId: "t1" },
      { index: 7, abandoned: true },
    ]);
    expect(steps[0]).toMatchObject({ index: 0, actionKind: "click", durationMs: 1200 });
    expect(steps[1]).toMatchObject({ index: 7, abandoned: true });
  });

  it("rejects non-arrays and non-objects", () => {
    expect(() => importHumanSteps(null)).toThrow();
    expect(() => importHumanSteps([42])).toThrow();
  });

  it("parses nested state and self-reports, dropping mistyped fields", () => {
    const [step] = importHumanSteps([
      {
        taskId: "t1",
        state: {
          kind: "human",
          taskId: "t1",
          url: "https://x.test/a",
          eveStableKey: "s0",
          externalStateId: 42,
          injected: true,
        },
        selfReport: { confidence: 0.7, mood: "good", broken: Number.NaN },
      },
    ]);
    expect(step!.state?.eveStableKey).toBe("s0");
    expect(step!.state?.externalStateId).toBeUndefined();
    expect(step!.selfReport).toEqual({ confidence: 0.7 });
  });
});
