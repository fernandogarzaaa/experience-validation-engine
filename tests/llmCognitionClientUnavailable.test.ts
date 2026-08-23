import { beforeEach, describe, expect, it, vi } from "vitest";

import { asFallbackReportingPolicy } from "../src/cognition/cognition.js";
import { LlmCognition } from "../src/cognition/llmCognition.js";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { OperatorMemory } from "../src/memory/memory.js";
import { getPersona } from "../src/personas/library.js";
import { createGoal, GoalStack } from "../src/planning/goals.js";

/**
 * The Anthropic client throwing at *construction* time (the shape of a
 * missing/invalid API key with the real SDK) is exercised in its own file:
 * mocking `@anthropic-ai/sdk` to throw and then un-mocking it for other
 * tests in the same file is exactly the kind of module-registry state that
 * leaks across tests sharing a file, so this scenario gets an isolated one.
 */
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function ThrowingAnthropicCtor() {
    throw new Error("Missing API key");
  }),
}));

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

describe("LlmCognition when the Anthropic client cannot be constructed", () => {
  beforeEach(async () => {
    vi.mocked((await import("@anthropic-ai/sdk")).default).mockClear();
  });

  it("falls back to heuristic cognition and records why", async () => {
    const policy = new LlmCognition({ apiKey: "sk-test" });
    const decision = await policy.decide(buildContext());

    expect(decision.action).toBeDefined();
    const reason = asFallbackReportingPolicy(policy)?.takeFallbackReason();
    expect(reason).toContain("Anthropic client is unavailable");
    expect(reason).toContain("Missing API key");
  });

  it("caches the load failure rather than retrying the import every step", async () => {
    const importSpy = vi.mocked((await import("@anthropic-ai/sdk")).default);
    const policy = new LlmCognition({ apiKey: "sk-test" });

    await policy.decide(buildContext());
    await policy.decide(buildContext());

    expect(importSpy).toHaveBeenCalledTimes(1);
  });
});
