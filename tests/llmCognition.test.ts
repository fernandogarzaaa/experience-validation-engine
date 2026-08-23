import { beforeEach, describe, expect, it, vi } from "vitest";

import { asFallbackReportingPolicy } from "../src/cognition/cognition.js";
import { LlmCognition } from "../src/cognition/llmCognition.js";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { OperatorMemory } from "../src/memory/memory.js";
import { getPersona } from "../src/personas/library.js";
import { createGoal, GoalStack } from "../src/planning/goals.js";

/**
 * `LlmCognition` imports `@anthropic-ai/sdk` with a runtime-computed
 * specifier (an optional peer must not be resolved at compile time), but
 * Vitest's module mocking intercepts by resolved specifier, not by AST
 * shape, so `vi.mock` still works here.
 */
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

class MockAnthropic {
  apiKey?: string;
  timeout?: number;
  messages = { create: createMock };
  constructor(opts?: { apiKey?: string; timeout?: number }) {
    this.apiKey = opts?.apiKey;
    this.timeout = opts?.timeout;
  }
}

vi.mock("@anthropic-ai/sdk", () => ({ default: MockAnthropic }));

function element(
  id: number,
  text: string,
  overrides: Partial<VisibleElement> = {},
): VisibleElement {
  return {
    id,
    role: "button",
    text,
    box: { x: 10, y: 10 + id * 50, width: 120, height: 40 },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "Test",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: [element(0, "Continue", { role: "link" })],
    dialogs: [],
    loadingIndicator: false,
  };
}

function buildContext() {
  const persona = getPersona("office-worker");
  const rng = createRng(1);
  const memory = new OperatorMemory(persona, rng);
  const goals = new GoalStack(createGoal("finish the task"));
  return {
    percept: percept(),
    previousPercept: null,
    persona,
    emotion: {
      confidence: 0.5,
      frustration: 0.1,
      trust: 0.5,
      confusion: 0.1,
      curiosity: 0.5,
      fatigue: 0.1,
      satisfaction: 0.5,
      interest: 0.5,
      stress: 0.1,
    },
    memory,
    goals,
    rng,
    step: 0,
    elapsedMs: 0,
  };
}

function jsonResponse(body: Record<string, unknown>) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(body) }] };
}

describe("LlmCognition", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("maps a successful, well-formed response to a Decision", async () => {
    createMock.mockResolvedValue(
      jsonResponse({
        action: "click",
        elementId: 0,
        rationale: "The Continue link looks right.",
        expectedOutcome: "Moves to the next step.",
        expectedSignals: ["next"],
        confidence: 0.8,
      }),
    );
    const policy = new LlmCognition({ apiKey: "sk-test" });
    const decision = await policy.decide(buildContext());

    expect(decision.action).toEqual({ kind: "click", target: expect.objectContaining({ id: 0 }) });
    expect(decision.rationale).toBe("The Continue link looks right.");
    expect(asFallbackReportingPolicy(policy)?.takeFallbackReason()).toBeNull();
  });

  it("passes the configured timeoutMs as a per-request option", async () => {
    createMock.mockResolvedValue(
      jsonResponse({
        action: "wait",
        rationale: "Waiting a moment.",
        expectedOutcome: "Nothing changes yet.",
        expectedSignals: [],
        confidence: 0.5,
      }),
    );
    const policy = new LlmCognition({ apiKey: "sk-test", timeoutMs: 12_345 });
    await policy.decide(buildContext());

    expect(createMock).toHaveBeenCalledWith(expect.anything(), { timeout: 12_345 });
  });

  it("defaults timeoutMs to 30s when not configured", async () => {
    createMock.mockResolvedValue(
      jsonResponse({
        action: "wait",
        rationale: "Waiting.",
        expectedOutcome: "Nothing changes.",
        expectedSignals: [],
        confidence: 0.5,
      }),
    );
    const policy = new LlmCognition({ apiKey: "sk-test" });
    await policy.decide(buildContext());

    expect(createMock).toHaveBeenCalledWith(expect.anything(), { timeout: 30_000 });
  });

  it("falls back to heuristic cognition and records why when the call throws", async () => {
    createMock.mockRejectedValue(new Error("rate limit exceeded"));
    const policy = new LlmCognition({ apiKey: "sk-test" });
    const ctx = buildContext();

    const decision = await policy.decide(ctx);

    // The fallback still produces a working, well-formed decision.
    expect(decision.action).toBeDefined();
    expect(decision.prediction).toBeDefined();

    const reason = asFallbackReportingPolicy(policy)?.takeFallbackReason();
    expect(reason).toContain("rate limit exceeded");
    expect(reason).toContain("falling back to heuristic cognition");
    // Consumed on read: a second call without a fresh fallback returns null.
    expect(asFallbackReportingPolicy(policy)?.takeFallbackReason()).toBeNull();
  });

  it("falls back and records why when the model refuses", async () => {
    createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });
    const policy = new LlmCognition({ apiKey: "sk-test" });
    const decision = await policy.decide(buildContext());

    expect(decision.action).toBeDefined();
    expect(asFallbackReportingPolicy(policy)?.takeFallbackReason()).toContain("refused");
  });

  it("falls back and records why when the response maps to no valid action", async () => {
    createMock.mockResolvedValue(
      jsonResponse({
        action: "click",
        elementId: 999, // no such element on screen
        rationale: "Clicking something that doesn't exist.",
        expectedOutcome: "?",
        expectedSignals: [],
        confidence: 0.5,
      }),
    );
    const policy = new LlmCognition({ apiKey: "sk-test" });
    const decision = await policy.decide(buildContext());

    expect(decision.action).toBeDefined();
    const reason = asFallbackReportingPolicy(policy)?.takeFallbackReason();
    expect(reason).toContain("could not be mapped");
  });

  it("does not report a policy without a fallback-reporting interface", () => {
    const plain = { name: "custom", decide: async () => ({}) as never };
    expect(asFallbackReportingPolicy(plain)).toBeNull();
  });
});
