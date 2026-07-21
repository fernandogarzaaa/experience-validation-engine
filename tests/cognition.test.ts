import { describe, expect, it } from "vitest";
import {
  comparePrediction,
  predictInteraction,
  perceivesError,
  tokenize,
} from "../src/cognition/index.js";
import type { Percept, VisibleElement } from "../src/core/types.js";

function element(text: string, overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: 0,
    role: "button",
    text,
    box: { x: 10, y: 10, width: 120, height: 40 },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(texts: string[], url = "https://x.test/"): Percept {
  return {
    timestamp: 0,
    url,
    title: "Test",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: texts.map((text, id) => ({ ...element(text), id })),
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("mental model", () => {
  it("tokenizes labels dropping stopwords", () => {
    expect(tokenize("Go to the Settings page")).toEqual(["settings", "page"]);
  });

  it("predicts navigation from link labels", () => {
    const prediction = predictInteraction(element("Billing settings", { role: "link" }), "click", 0.7);
    expect(prediction.expectedSignals).toContain("billing");
    expect(prediction.expectsChange).toBe(true);
  });

  it("predicts confirmation for destructive controls", () => {
    const prediction = predictInteraction(element("Delete account"), "click", 0.7);
    expect(prediction.expectedSignals).toContain("confirm");
  });

  it("detects visible errors", () => {
    expect(perceivesError(percept(["Something went wrong"]))).toBe(true);
    expect(perceivesError(percept(["All good here"]))).toBe(false);
  });

  it("high surprise when an expected change never happens", () => {
    const before = percept(["Save"]);
    const prediction = predictInteraction(element("Save"), "click", 0.8);
    const outcome = comparePrediction(prediction, before, before, 100);
    expect(outcome.screenChanged).toBe(false);
    expect(outcome.surprise).toBeGreaterThan(0.7);
  });

  it("low surprise when expected signals appear on the next screen", () => {
    const before = percept(["Open billing"], "https://x.test/");
    const after = percept(
      ["Billing overview", "Invoices", "Payment methods"],
      "https://x.test/billing",
    );
    const prediction = predictInteraction(element("Billing", { role: "link" }), "click", 0.8);
    const outcome = comparePrediction(prediction, before, after, 100);
    expect(outcome.screenChanged).toBe(true);
    expect(outcome.matchedSignals).toContain("billing");
    expect(outcome.surprise).toBeLessThan(0.4);
  });

  it("errors amplify surprise", () => {
    const before = percept(["Save"]);
    const after = percept(["Error: something went wrong"], "https://x.test/error");
    const prediction = predictInteraction(element("Save"), "click", 0.8);
    const outcome = comparePrediction(prediction, before, after, 100);
    expect(outcome.errorPerceived).toBe(true);
    expect(outcome.surprise).toBeGreaterThan(0.5);
  });
});
