import { describe, expect, it } from "vitest";
import type { Percept } from "../src/core/types.js";
import { HeuristicMultimodalPerceptor } from "../src/multimodal/perceptor.js";
import { AccessibilityPlugin } from "../src/plugins/accessibility.js";
import type { SurfaceCapabilities } from "../src/surface/capabilities.js";
import { TEXTUAL_SURFACE, VISUAL_SURFACE } from "../src/surface/capabilities.js";
import { checkPixels } from "../src/vision/analysis.js";

function percept(): Percept {
  return {
    timestamp: 0,
    url: "cli:demo",
    title: "demo",
    viewport: { width: 960, height: 432 },
    scrollY: 0,
    scrollHeight: 100,
    screenshot: null,
    elements: [
      {
        id: 0,
        role: "image",
        text: "",
        box: { x: 0, y: 0, width: 64, height: 64 },
        interactive: false,
        disabled: false,
        editable: false,
        focused: false,
        clippedByViewport: false,
      },
    ],
    dialogs: [],
    loadingIndicator: false,
  };
}

function context(capabilities: SurfaceCapabilities) {
  const findings: unknown[] = [];
  const persona = { accessibility: { keyboardOnly: false } };
  return { findings, ctx: { capabilities, persona, report: (f: unknown) => findings.push(f) } };
}

describe("spatial guards", () => {
  it("reports pixel-dependent findings on a visual surface", async () => {
    const { findings, ctx } = context(VISUAL_SURFACE);
    await new AccessibilityPlugin().onPercept(ctx as never, percept());
    expect(findings.length).toBeGreaterThan(0);
  });

  it("skips pixel-dependent findings on a textual surface", async () => {
    const { findings, ctx } = context(TEXTUAL_SURFACE);
    await new AccessibilityPlugin().onPercept(ctx as never, percept());
    expect(findings).toHaveLength(0);
  });
});

describe("vision/multimodal layer on a textual surface", () => {
  it("never emits a pixel-derived finding when screenshot is null", () => {
    const textual = { ...percept(), screenshot: null };
    expect(checkPixels(textual)).toEqual([]);
  });

  it("never emits an animation cue between two screenshot-less frames", () => {
    const prev = { ...percept(), screenshot: null };
    const next = { ...percept(), screenshot: null };
    const { cues } = new HeuristicMultimodalPerceptor().perceive(next, prev);
    expect(cues.some((c) => c.kind === "animation")).toBe(false);
  });
});
