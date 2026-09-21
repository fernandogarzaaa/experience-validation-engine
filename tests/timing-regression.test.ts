import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import {
  computePerceivedLatency,
  EveSession,
  latencyEvidenceFor,
  TIMING_SEMANTICS,
} from "../src/engine/index.js";

describe("computePerceivedLatency (P0.1)", () => {
  it("measures settled-observation minus actuation completion", () => {
    expect(computePerceivedLatency({ actuationEndMs: 1000, settledObservationMs: 1250 })).toBe(250);
  });

  it("clamps negative clock skew to zero", () => {
    expect(computePerceivedLatency({ actuationEndMs: 2000, settledObservationMs: 1999 })).toBe(0);
  });

  it("counts settle exactly once: no additive settle term", () => {
    // The helper takes only two timestamps — there is no parameter through
    // which a caller could add settleMs a second time.
    expect(computePerceivedLatency.length).toBe(1);
    expect(TIMING_SEMANTICS).toContain("exactly once");
  });
});

describe("session perceived latency (P0.1)", () => {
  const runLatencies = async (seed: number): Promise<number[]> => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed,
      maxSteps: 12,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    return result.iterations.map((it) => it.outcome?.perceivedLatencyMs ?? -1);
  };

  it("is deterministic: identical latency on identical seeds", async () => {
    const [a, b] = await Promise.all([runLatencies(1234), runLatencies(1234)]);
    expect(a).toEqual(b);
  }, 30_000);

  it("excludes human motor time: mock surface latency is zero while session duration is not", async () => {
    // The mock surface answers instantly (no loading, no surface wait), so
    // every perceived latency must be 0 — even though the operator spent
    // real modeled-human time reading/hesitating/typing (usage.durationMs).
    // The pre-fix code measured from decision start and reported >0 here.
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 1234,
      maxSteps: 12,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    expect(result.iterations.length).toBeGreaterThan(0);
    for (const it of result.iterations) {
      expect(it.outcome?.perceivedLatencyMs).toBe(0);
    }
    expect(result.usage.durationMs).toBeGreaterThan(0);
  }, 30_000);

  it("never reports negative latency", async () => {
    const latencies = await runLatencies(7);
    for (const lat of latencies) expect(lat).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

describe("latency evidence (reviewer decision 3)", () => {
  it("builds modeled evidence in deterministic mode", () => {
    const ev = latencyEvidenceFor({ modeledMs: 120, observedMs: 5, deterministic: true });
    expect(ev.source).toBe("modeled");
    expect(ev.deterministic).toBe(true);
    expect(ev.modeledMs).toBe(120);
    // Host wall time is deliberately NOT recorded in deterministic mode:
    // it would contaminate replay determinism.
    expect(ev.observedMs).toBe(0);
  });

  it("builds environmental evidence in wall-clock mode", () => {
    const ev = latencyEvidenceFor({ modeledMs: 3, observedMs: 410, deterministic: false });
    expect(ev.source).toBe("environmental");
    expect(ev.observedMs).toBe(410);
  });

  it("every session outcome carries latency evidence + motor time", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 1234,
      maxSteps: 12,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    expect(result.iterations.length).toBeGreaterThan(0);
    for (const it of result.iterations) {
      const ev = it.outcome?.latencyEvidence;
      expect(ev).toBeDefined();
      expect(ev!.source).toBe("modeled");
      expect(ev!.deterministic).toBe(true);
      // Modeled interval equals the reported latency in deterministic mode.
      expect(ev!.modeledMs).toBe(it.outcome!.perceivedLatencyMs);
      expect(it.outcome!.motorTimeMs).toBeGreaterThanOrEqual(0);
    }
    // Human motor time is tracked separately from surface latency.
    const motorTotal = result.iterations.reduce((s, it) => s + (it.outcome?.motorTimeMs ?? 0), 0);
    expect(motorTotal).toBeGreaterThan(0);
  }, 30_000);
});
