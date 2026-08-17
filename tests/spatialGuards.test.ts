import { describe, expect, it } from "vitest";
import type { BrowserAdapter, RawSnapshot } from "../src/browser/adapter.js";
import type { Percept } from "../src/core/types.js";
import { EveSession } from "../src/engine/session.js";
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

/**
 * Engine-level guard: the session loop's own vision checks must honor the
 * same `capabilities.spatial` gate the plugins respect. The fixture below is
 * a surface whose geometry would produce findings if the checks ran (a tiny
 * interactive target and a viewport-clipped element), so a run that emits no
 * `Check:`-evidenced finding proves the gate, not an inert fixture.
 */
class StaticSurfaceAdapter implements BrowserAdapter {
  readonly name = "static-surface";

  constructor(readonly capabilities: SurfaceCapabilities) {}

  open(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): Promise<RawSnapshot> {
    return Promise.resolve({
      url: "surface:demo",
      title: "demo",
      viewport: { width: 960, height: 432 },
      scrollY: 0,
      scrollHeight: 432,
      elements: [
        {
          id: 0,
          role: "button",
          text: "Go",
          box: { x: 0, y: 0, width: 10, height: 10 },
          interactive: true,
          disabled: false,
          editable: false,
          focused: false,
          clippedByViewport: false,
        },
        {
          id: 1,
          role: "text",
          text: "partially off-screen content",
          box: { x: 900, y: 10, width: 120, height: 20 },
          interactive: false,
          disabled: false,
          editable: false,
          focused: false,
          clippedByViewport: true,
        },
      ],
      dialogs: [],
      loadingIndicator: false,
    });
  }

  screenshot(): Promise<Buffer | null> {
    return Promise.resolve(null);
  }

  moveMouse(): Promise<void> {
    return Promise.resolve();
  }

  clickAt(): Promise<void> {
    return Promise.resolve();
  }

  doubleClickAt(): Promise<void> {
    return Promise.resolve();
  }

  typeText(): Promise<void> {
    return Promise.resolve();
  }

  pressKey(): Promise<void> {
    return Promise.resolve();
  }

  scrollBy(): Promise<void> {
    return Promise.resolve();
  }

  goBack(): Promise<void> {
    return Promise.resolve();
  }

  navigate(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function runStaticSurface(capabilities: SurfaceCapabilities) {
  const session = new EveSession({
    adapter: new StaticSurfaceAdapter(capabilities),
    startUrl: "surface:demo",
    seed: 9,
    maxSteps: 4,
    paceScale: 0,
  });
  return session.run();
}

/** Vision findings the engine produces carry `Check: <kind>` evidence. */
function visionFindings(result: Awaited<ReturnType<typeof runStaticSurface>>) {
  return result.findings.filter((f) => f.evidence.some((e) => e.startsWith("Check:")));
}

describe("engine-level vision checks", () => {
  it("produce geometry findings on a spatial surface (fixture is not inert)", async () => {
    const result = await runStaticSurface({ ...VISUAL_SURFACE, canScreenshot: false });
    expect(visionFindings(result).length).toBeGreaterThan(0);
  }, 15_000);

  it("are skipped, not failed, on a non-spatial surface", async () => {
    const result = await runStaticSurface(TEXTUAL_SURFACE);
    expect(visionFindings(result)).toHaveLength(0);
    expect(result.findings.some((f) => f.category === "visual")).toBe(false);
  }, 15_000);
});
