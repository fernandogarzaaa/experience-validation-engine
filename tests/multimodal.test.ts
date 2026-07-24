import { describe, it, expect } from "vitest";

import type { Percept, VisibleElement, PerceivedRole } from "../src/core/types.js";
import { EveSession } from "../src/engine/session.js";
import { MockAdapter, type MockAppSpec } from "../src/browser/index.js";
import {
  HeuristicMultimodalPerceptor,
  analyzeScreens,
  analyzeMultimodal,
  renderMultimodalMarkdown,
} from "../src/multimodal/index.js";

function el(role: PerceivedRole, text: string, over: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: 1,
    role,
    text,
    box: { x: 0, y: 0, width: 40, height: 40 },
    interactive: role === "button" || role === "link",
    disabled: false,
    editable: false,
    focused: false,
    ...over,
  };
}

function percept(url: string, elements: VisibleElement[], over: Partial<Percept> = {}): Percept {
  return {
    timestamp: 0,
    url,
    title: url,
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs: [],
    loadingIndicator: false,
    ...over,
  };
}

describe("HeuristicMultimodalPerceptor", () => {
  const perceptor = new HeuristicMultimodalPerceptor();

  it("recognizes charts, media, text-in-image and unlabeled images", () => {
    const p = percept("mock:home", [
      el("image", "Revenue chart trend"),
      el("image", ""), // unlabeled
    ]);
    const kinds = perceptor.perceive(p).cues.map((c) => c.kind);
    expect(kinds).toContain("chart");
    expect(kinds).toContain("text-in-image");
    expect(kinds.filter((k) => k === "media")).toHaveLength(2);
    const unlabeledMedia = perceptor.perceive(p).cues.find((c) => c.kind === "media" && !c.accessible);
    expect(unlabeledMedia).toBeDefined();
  });

  it("recognizes icon-only controls, loading, and toasts", () => {
    const p = percept(
      "mock:home",
      [el("button", ""), el("alert", "Saved successfully"), el("progress", "")],
      { loadingIndicator: true },
    );
    const cues = perceptor.perceive(p).cues;
    expect(cues.some((c) => c.kind === "icon" && !c.accessible)).toBe(true);
    expect(cues.some((c) => c.kind === "loading")).toBe(true);
    expect(cues.some((c) => c.kind === "toast")).toBe(true);
  });

  it("detects toasts from transient dialogs", () => {
    const p = percept("mock:home", [el("heading", "Home")], {
      dialogs: [{ text: "Item deleted", box: null }],
    });
    expect(perceptor.perceive(p).cues.some((c) => c.kind === "toast")).toBe(true);
  });

  it("stays quiet on a plain text screen (human boundary — no hallucinated cues)", () => {
    const p = percept("mock:home", [el("heading", "Welcome"), el("text", "Some copy")]);
    expect(perceptor.perceive(p).cues).toHaveLength(0);
  });
});

describe("analyzeScreens", () => {
  it("aggregates cues and flags unlabeled visuals", () => {
    const report = analyzeScreens([
      percept("a", [el("image", ""), el("button", "")]),
      percept("b", [el("image", "labeled"), el("alert", "Sent")], { loadingIndicator: true }),
    ]);
    expect(report.screensAnalyzed).toBe(2);
    expect(report.totalCues).toBeGreaterThan(0);
    expect(report.screensWithLoading).toBe(1);
    expect(report.toasts.length).toBeGreaterThan(0);
    // The unlabeled image and icon-only button are perception risks.
    expect(report.unlabeled.length).toBeGreaterThanOrEqual(2);
    expect(renderMultimodalMarkdown(report)).toContain("Multimodal perception report");
  });
});

describe("analyzeMultimodal (integration)", () => {
  it("scans a visually rich mock app end-to-end", async () => {
    const app: MockAppSpec = {
      name: "Viz",
      start: "home",
      screens: [
        {
          id: "home",
          title: "Dashboard",
          elements: [
            { role: "heading", text: "Analytics" },
            { role: "image", text: "Revenue chart showing an upward trend" },
            { role: "image", text: "" },
            { role: "button", text: "", goto: "home" },
            { role: "button", text: "Open", goto: "done" },
            { role: "alert", text: "Report saved successfully" },
          ],
        },
        { id: "done", title: "Done", elements: [{ role: "heading", text: "Done" }, { role: "button", text: "Back", goto: "home" }] },
      ],
    };
    const result = await new EveSession({
      adapter: new MockAdapter(app),
      startUrl: "mock:",
      persona: "curious-explorer",
      seed: 7,
      maxSteps: 20,
    }).run();
    const report = analyzeMultimodal(result);
    expect(report.byKind.chart).toBeGreaterThanOrEqual(1);
    expect(report.byKind.media).toBeGreaterThanOrEqual(1);
    expect(report.unlabeled.length).toBeGreaterThan(0);
  }, 60_000);
});
