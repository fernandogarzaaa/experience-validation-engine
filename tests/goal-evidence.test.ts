import { describe, expect, it } from "vitest";
import type { Percept } from "../src/core/types.js";
import { assessGoal, assessGoalOnPercepts } from "../src/planning/index.js";

function percept(texts: string[]): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/done",
    title: "Done",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: texts.map((text, id) => ({
      id,
      role: "text" as const,
      text,
      box: { x: 0, y: id * 20, width: 200, height: 20 },
      interactive: false,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
    })),
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("goal evidence model (P0.4)", () => {
  it("reports no achievement when the signal is absent", () => {
    const r = assessGoal({ signals: ["export complete"], visibleHaystack: "nothing here" });
    expect(r.achieved).toBe(false);
    expect(r.evidence).toHaveLength(0);
  });

  it("grades a rendered-text match as visual-confirmation (text-only, moderate)", () => {
    const r = assessGoal({
      signals: ["export complete"],
      visibleHaystack: "Export complete",
      renderedHaystack: "Export complete",
    });
    expect(r.achieved).toBe(true);
    expect(r.evidence.some((e) => e.kind === "visual-confirmation")).toBe(true);
    expect(r.evidence.every((e) => e.textOnly)).toBe(true);
  });

  it("grades an accessibility-only match as weak text-proxy with a warning", () => {
    const r = assessGoal({
      signals: ["export complete"],
      visibleHaystack: "Export complete",
      renderedHaystack: "something else entirely",
    });
    expect(r.achieved).toBe(true);
    expect(r.evidence.some((e) => e.kind === "text-proxy" && e.strength === "weak")).toBe(true);
    expect(r.warnings.join(" ")).toContain("text-proxy");
  });

  it("adds state-transition evidence when the screen changed after the action", () => {
    const r = assessGoal({
      signals: ["download ready"],
      visibleHaystack: "Download ready",
      renderedHaystack: "Download ready",
      screenChangedSinceAction: true,
    });
    expect(r.evidence.some((e) => e.kind === "state-transition" && e.strength === "strong")).toBe(
      true,
    );
  });

  it("adds destination-state and workflow-terminal evidence when declared", () => {
    const r = assessGoal({
      signals: ["all set"],
      visibleHaystack: "All set",
      renderedHaystack: "All set",
      atDestinationState: true,
      workflowTerminal: true,
      url: "https://x.test/welcome",
    });
    expect(r.evidence.some((e) => e.kind === "destination-state")).toBe(true);
    expect(r.evidence.some((e) => e.kind === "workflow-terminal")).toBe(true);
  });

  it("assessGoalOnPercepts derives the rendered surface from the percept", () => {
    // Signal present only in an accessibility fallback: weak text-proxy.
    const p = percept([]);
    const r = assessGoalOnPercepts({
      signals: ["close dialog"],
      visibleText: "Close dialog",
      percept: p,
    });
    expect(r.achieved).toBe(true);
    expect(r.evidence[0]!.kind).toBe("text-proxy");
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
