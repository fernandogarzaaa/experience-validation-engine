import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { LlmCognition } from "../src/cognition/llmCognition.js";
import { EveSession } from "../src/engine/session.js";
import { LlmCriticPlugin } from "../src/plugins/llmCritic.js";
import type { EvePlugin, PluginContext } from "../src/plugins/plugin.js";

/**
 * End-to-end check that a session-level `LlmCognition`/`LlmCriticPlugin`
 * fallback is actually visible on the finished `SessionResult` and on
 * `session.events` — not just on the policy/plugin object directly (see
 * `tests/llmCognition.test.ts` and `tests/llmCritic.test.ts` for that
 * narrower unit coverage). This is the failure mode item 5 of the
 * production-readiness audit exists for: a user who enables `llmCognition`
 * and forgets an API key previously got a fully heuristic-driven run with a
 * report that looked LLM-backed and zero indication anything degraded.
 */
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

class MockAnthropic {
  messages = { create: createMock };
}

vi.mock("@anthropic-ai/sdk", () => ({ default: MockAnthropic }));

describe("EveSession surfaces LLM fallback", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockRejectedValue(new Error("rate limit exceeded"));
  });

  it("still produces a working, heuristic-driven session when llmCognition degrades", async () => {
    const events: Array<{ source: string; reason: string }> = [];
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      policy: new LlmCognition({ apiKey: "sk-test" }),
      seed: 42,
      maxSteps: 10,
      paceScale: 0,
    });
    session.events.on("llm:fallback", (e) => events.push(e));

    const result = await session.run();

    // The run completed normally on the heuristic fallback rather than
    // dying or silently doing nothing.
    expect(result.error).toBeNull();
    expect(result.iterations.length).toBeGreaterThan(0);

    // The degradation is visible on the result, not just in logs.
    expect(result.llmFallbackWarnings.length).toBeGreaterThan(0);
    expect(result.llmFallbackWarnings[0]).toContain("cognition");
    expect(result.llmFallbackWarnings[0]).toContain("rate limit exceeded");

    // ...and on the event bus.
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.source).toBe("cognition");
  }, 30_000);

  it("de-duplicates repeated fallbacks into one advisory", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      policy: new LlmCognition({ apiKey: "sk-test" }),
      seed: 42,
      maxSteps: 10,
      paceScale: 0,
    });

    const result = await session.run();

    // Every single decide() call fails the same way; one advisory, not one
    // per step, exactly like `goalSignalWarnings`'s dedupe.
    const cognitionWarnings = result.llmFallbackWarnings.filter((w) => w.includes("cognition"));
    expect(cognitionWarnings.length).toBe(1);
  }, 30_000);

  it("surfaces an llmCritic plugin fallback alongside a cognition fallback", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      policy: new LlmCognition({ apiKey: "sk-test" }),
      plugins: [new LlmCriticPlugin({ apiKey: "sk-test" })],
      seed: 42,
      maxSteps: 10,
      paceScale: 0,
    });

    const result = await session.run();

    expect(result.llmFallbackWarnings.some((w) => w.includes("cognition"))).toBe(true);
    expect(result.llmFallbackWarnings.some((w) => w.includes("plugin"))).toBe(true);
  }, 30_000);

  it("accepts a fallback reported from a plugin's onSessionStart, before the loop runs", async () => {
    // Regression guard: reportLlmFallback's underlying recorder must be
    // initialized before plugins.sessionStart() runs, since a plugin may
    // call it from onSessionStart — the very first plugin hook invoked.
    // Declaring the recorder after that call would make this throw a
    // ReferenceError (TDZ), silently swallowed as a generic plugin error.
    class EagerFallbackPlugin implements EvePlugin {
      readonly name = "eager-fallback";
      onSessionStart(ctx: PluginContext): void {
        ctx.reportLlmFallback("reported during onSessionStart");
      }
    }

    const errors: Array<{ err: unknown; plugin: string }> = [];
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      plugins: [new EagerFallbackPlugin()],
      seed: 42,
      maxSteps: 5,
      paceScale: 0,
      onLog: (line) => {
        if (line.startsWith("plugin ") && line.includes("error")) {
          errors.push({ err: line, plugin: "eager-fallback" });
        }
      },
    });

    const result = await session.run();

    expect(errors).toEqual([]);
    expect(
      result.llmFallbackWarnings.some((w) => w.includes("reported during onSessionStart")),
    ).toBe(true);
  }, 30_000);

  it("is empty when llmCognition is not used at all", async () => {
    const result = await new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 42,
      maxSteps: 10,
      paceScale: 0,
    }).run();

    expect(result.llmFallbackWarnings).toEqual([]);
  }, 30_000);
});
