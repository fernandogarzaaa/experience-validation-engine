import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import type { Percept } from "../src/core/types.js";
import { EveSession } from "../src/engine/index.js";
import {
  buildExperienceTrace,
  renderTraceJson,
  renderTraceJsonl,
  stripPercept,
  traceIdFor,
} from "../src/trace/index.js";

function percept(url = "https://x.test/"): Percept {
  return {
    timestamp: 0,
    url,
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: Buffer.from([1, 2, 3]),
    elements: [],
    dialogs: [],
    loadingIndicator: false,
  };
}

async function run(opts: Record<string, unknown> = {}) {
  const session = new EveSession({
    adapter: new MockAdapter(DEMO_APP),
    startUrl: "mock:landing",
    persona: "office-worker",
    seed: 11,
    maxSteps: 10,
    paceScale: 0,
    deterministic: true,
    ...opts,
  } as never);
  return session.run();
}

describe("ExperienceTrace (Phase 1)", () => {
  it("chains state_before → action → state_after for every action", async () => {
    const trace = buildExperienceTrace(await run());
    expect(trace.steps.length).toBeGreaterThan(0);
    for (let i = 0; i < trace.steps.length; i++) {
      const st = trace.steps[i]!;
      expect(st.stateBefore.url).toBeTruthy();
      if (st.selectedAction.kind === "abandon") {
        // No actuation: after-state honestly equals before-state.
        expect(st.stateAfter).toEqual(st.stateBefore);
      } else if (i + 1 < trace.steps.length) {
        // Genuine forward chain: after == next before.
        const next = trace.steps[i + 1]!;
        expect(st.stateAfter?.url).toBe(next.stateBefore.url);
        expect(st.stateAfter?.stableKey).toBe(next.stateBefore.stableKey);
      } else {
        // Final action: after-state is the terminal observation.
        expect(st.stateAfter?.url).toBe(trace.terminal?.url);
      }
    }
  });

  it("captures a genuine terminal observation on completion paths", async () => {
    const trace = buildExperienceTrace(await run());
    expect(trace.terminal).not.toBeNull();
    expect(trace.terminal!.url).toBeTruthy();
    expect(trace.terminal!.elementCount).toBeGreaterThanOrEqual(0);
  });

  it("captures terminal abandonment state with descriptive info", async () => {
    const trace = buildExperienceTrace(await run({ persona: "impatient-user", maxSteps: 30 }));
    expect(trace.terminal).not.toBeNull();
    if (trace.abandoned) {
      const ab = trace.terminal!.abandonment;
      expect(ab).toBeDefined();
      expect(ab!.stepToAbandon).toBeGreaterThanOrEqual(0);
      expect(ab!.stateKey).toBeTruthy();
    }
  });

  it("is deterministic: same result → byte-identical trace", async () => {
    const a = buildExperienceTrace(await run());
    const b = buildExperienceTrace(await run());
    expect(renderTraceJson(a)).toBe(renderTraceJson(b));
    expect(a.traceId).toBe(b.traceId);
  });

  it("derives stable identity from generating parameters", () => {
    expect(traceIdFor({ seed: 1, persona: "a", taskId: null, startUrl: "u" })).toBe(
      traceIdFor({ seed: 1, persona: "a", taskId: null, startUrl: "u" }),
    );
    expect(traceIdFor({ seed: 1, persona: "a", taskId: null, startUrl: "u" })).not.toBe(
      traceIdFor({ seed: 2, persona: "a", taskId: null, startUrl: "u" }),
    );
  });

  it("propagates task identity without altering behavior", async () => {
    const plain = buildExperienceTrace(await run());
    expect(plain.taskId).toBeNull();
    const tasked = buildExperienceTrace(await run({ taskId: "checkout_basic_01" }));
    expect(tasked.taskId).toBe("checkout_basic_01");
    expect(tasked.traceId).not.toBe(plain.traceId);
  });

  it("handles empty results with explicit absence, not fabrication", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 11,
      maxSteps: 0,
      paceScale: 0,
      deterministic: true,
    });
    const trace = buildExperienceTrace(await session.run());
    expect(trace.steps).toHaveLength(0);
    expect(trace.initialState).toBeNull();
    expect(trace.terminal).toBeNull();
  });

  it("serializes to JSON and JSONL losslessly", async () => {
    const trace = buildExperienceTrace(await run());
    expect(JSON.parse(renderTraceJson(trace))).toEqual(JSON.parse(JSON.stringify(trace)));
    const lines = renderTraceJsonl(trace).split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).traceId).toBe(trace.traceId);
  });

  it("stripPercept removes buffers but preserves semantics", () => {
    const stripped = stripPercept(percept());
    expect(stripped.screenshot).toBeNull();
    expect(stripped.url).toBe("https://x.test/");
  });
});
