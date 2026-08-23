import { describe, expect, it, vi } from "vitest";

import type { Finding, Percept } from "../src/core/types.js";
import { getPersona } from "../src/personas/library.js";
import { LlmCriticPlugin } from "../src/plugins/llmCritic.js";
import type { PluginContext } from "../src/plugins/plugin.js";
import { VISUAL_SURFACE } from "../src/surface/capabilities.js";

/** See the identical note in `tests/llmCognitionClientUnavailable.test.ts`. */
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(function ThrowingAnthropicCtor() {
    throw new Error("Missing API key");
  }),
}));

function percept(): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "Test screen",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: [],
    dialogs: [],
    loadingIndicator: false,
  };
}

function buildCtx(): { ctx: PluginContext; findings: Finding[]; fallbacks: string[] } {
  const findings: Finding[] = [];
  const fallbacks: string[] = [];
  const ctx: PluginContext = {
    persona: getPersona("office-worker"),
    startUrl: "https://x.test/",
    capabilities: VISUAL_SURFACE,
    report: (f) => findings.push({ ...f, id: `F-${findings.length}`, timestamp: 0 }),
    reportLlmFallback: (reason) => fallbacks.push(reason),
  };
  return { ctx, findings, fallbacks };
}

describe("LlmCriticPlugin when the Anthropic client cannot be constructed", () => {
  it("reports a fallback and no finding, rather than failing the session", async () => {
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test" });
    const { ctx, findings, fallbacks } = buildCtx();

    await plugin.onPercept(ctx, percept());

    expect(findings).toEqual([]);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toContain("Anthropic client is unavailable");
    expect(fallbacks[0]).toContain("Missing API key");
  });
});
