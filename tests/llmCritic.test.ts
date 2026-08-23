import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Finding, Percept } from "../src/core/types.js";
import { getPersona } from "../src/personas/library.js";
import { LlmCriticPlugin } from "../src/plugins/llmCritic.js";
import type { PluginContext } from "../src/plugins/plugin.js";
import { VISUAL_SURFACE } from "../src/surface/capabilities.js";

/** See the identical note in `tests/llmCognition.test.ts`. */
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

function percept(url = "https://x.test/"): Percept {
  return {
    timestamp: 0,
    url,
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

function jsonResponse(issues: unknown[]) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ issues }) }] };
}

describe("LlmCriticPlugin", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("reports a finding per issue on a successful critique", async () => {
    createMock.mockResolvedValue(
      jsonResponse([
        {
          severity: "major",
          title: "Low contrast body text",
          description: "Body text is #ccc on white.",
          recommendation: "Darken to at least #595959.",
        },
      ]),
    );
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test" });
    const { ctx, findings, fallbacks } = buildCtx();

    await plugin.onPercept(ctx, percept());

    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toContain("Low contrast body text");
    expect(findings[0]?.severity).toBe("major");
    expect(fallbacks).toEqual([]);
  });

  it("passes the configured timeoutMs as a per-request option", async () => {
    createMock.mockResolvedValue(jsonResponse([]));
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test", timeoutMs: 5_000 });
    const { ctx } = buildCtx();

    await plugin.onPercept(ctx, percept());

    expect(createMock).toHaveBeenCalledWith(expect.anything(), { timeout: 5_000 });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "falls back to the 30s default for an invalid timeoutMs (%s)",
    async (invalid) => {
      createMock.mockResolvedValue(jsonResponse([]));
      const plugin = new LlmCriticPlugin({ apiKey: "sk-test", timeoutMs: invalid });
      const { ctx } = buildCtx();

      await plugin.onPercept(ctx, percept());

      expect(createMock).toHaveBeenCalledWith(expect.anything(), { timeout: 30_000 });
    },
  );

  it("critiques a screen only once", async () => {
    createMock.mockResolvedValue(jsonResponse([]));
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test" });
    const { ctx } = buildCtx();

    await plugin.onPercept(ctx, percept());
    await plugin.onPercept(ctx, percept());

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("reports a fallback (no finding) when the call throws", async () => {
    createMock.mockRejectedValue(new Error("network error"));
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test" });
    const { ctx, findings, fallbacks } = buildCtx();

    await plugin.onPercept(ctx, percept());

    expect(findings).toEqual([]);
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0]).toContain("network error");
  });

  it("reports a fallback when the model refuses", async () => {
    createMock.mockResolvedValue({ stop_reason: "refusal", content: [] });
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test" });
    const { ctx, findings, fallbacks } = buildCtx();

    await plugin.onPercept(ctx, percept());

    expect(findings).toEqual([]);
    expect(fallbacks[0]).toContain("refused");
  });

  it("stops critiquing once maxScreens is reached", async () => {
    createMock.mockResolvedValue(jsonResponse([]));
    const plugin = new LlmCriticPlugin({ apiKey: "sk-test", maxScreens: 1 });
    const { ctx } = buildCtx();

    await plugin.onPercept(ctx, percept("https://x.test/a"));
    await plugin.onPercept(ctx, percept("https://x.test/b"));

    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
