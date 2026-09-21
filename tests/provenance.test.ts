import { describe, expect, it } from "vitest";
import type { Percept, VisibleElement } from "../src/core/types.js";
import {
  accessibilitySourcedText,
  isHumanVisibleText,
  textSourceOf,
  visualOnlyText,
} from "../src/observation/index.js";

let id = 0;
function el(text: string, overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: id++,
    role: "text",
    text,
    box: { x: 0, y: 0, width: 100, height: 20 },
    interactive: false,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(elements: VisibleElement[]): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("observation provenance (P0.3)", () => {
  it("defaults legacy elements (no tag) to visual", () => {
    expect(textSourceOf(el("hello"))).toBe("visual");
    expect(isHumanVisibleText(el("hello"))).toBe(true);
  });

  it("marks accessibility fallbacks as not human-visible", () => {
    const aria = el("Close dialog", { textSource: "accessibility" });
    expect(textSourceOf(aria)).toBe("accessibility");
    expect(isHumanVisibleText(aria)).toBe(false);
  });

  it("visualOnlyText excludes aria/alt/title fallbacks", () => {
    const p = percept([
      el("Rendered heading"),
      el("aria-only label", { textSource: "accessibility" }),
      el("image alt text", { textSource: "accessibility" }),
    ]);
    const visual = visualOnlyText(p);
    expect(visual).toContain("Rendered heading");
    expect(visual).not.toContain("aria-only label");
    expect(visual).not.toContain("image alt text");
  });

  it("keeps accessibility evidence available (not removed)", () => {
    const p = percept([el("aria-only label", { textSource: "accessibility" })]);
    expect(accessibilitySourcedText(p)).toContain("aria-only label");
  });

  it("a sighted-visible label and an a11y label are different sources for the same string", () => {
    const seen = el("Save", { textSource: "visual" });
    const announced = el("Save", { textSource: "accessibility" });
    expect(textSourceOf(seen)).not.toBe(textSourceOf(announced));
    expect(isHumanVisibleText(seen)).toBe(true);
    expect(isHumanVisibleText(announced)).toBe(false);
  });
});
