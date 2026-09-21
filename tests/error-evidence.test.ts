import { describe, expect, it } from "vitest";
import {
  classifyErrorEvidence,
  errorSnippets,
  perceivesError,
} from "../src/cognition/mentalModel.js";
import type { Percept, VisibleElement } from "../src/core/types.js";

let id = 0;
function el(text: string, overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: id++,
    role: "text",
    text,
    box: { x: 0, y: 0, width: 300, height: 20 },
    interactive: false,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(elements: VisibleElement[], dialogs: Percept["dialogs"] = []): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs,
    loadingIndicator: false,
  };
}

describe("layered error evidence (P1.4)", () => {
  it.each([
    "Error rate: 1.2% this quarter",
    "Required reading for week 3",
    "Failed experiments archive",
    "Wrong answers explained below",
    "404 reference documentation",
  ])("does not flag content-about-failure: %s", (text) => {
    const p = percept([el(text)]);
    expect(perceivesError(p)).toBe(false);
    expect(errorSnippets(p)).toHaveLength(0);
    expect(classifyErrorEvidence(p).level).toBe("none");
  });

  it("flags semantic-role alerts as strong observed evidence", () => {
    const p = percept([el("Invalid password", { role: "alert" })]);
    const ev = classifyErrorEvidence(p);
    expect(ev.level).toBe("strong");
    expect(ev.provenance).toBe("observed");
    expect(perceivesError(p)).toBe(true);
  });

  it("flags native-dialog error text as strong observed evidence", () => {
    const p = percept([], [{ text: "Payment failed", box: null, source: "native" }]);
    expect(classifyErrorEvidence(p).level).toBe("strong");
    expect(perceivesError(p)).toBe(true);
  });

  it("flags form-context error text as moderate derived evidence", () => {
    const p = percept([el("This field is required", { editable: true })]);
    const ev = classifyErrorEvidence(p);
    expect(ev.level).toBe("moderate");
    expect(ev.provenance).toBe("derived");
    expect(perceivesError(p)).toBe(true);
  });

  it("keeps bare lexical matches as weak heuristic fallback", () => {
    const p = percept([el("Something went wrong")]);
    const ev = classifyErrorEvidence(p);
    expect(ev.level).toBe("weak");
    expect(ev.provenance).toBe("heuristic");
    expect(perceivesError(p)).toBe(true);
  });

  it("stays silent on document surfaces", () => {
    const p = percept([el("Something went wrong")]);
    expect(perceivesError(p, "document")).toBe(false);
    expect(errorSnippets(p, "document")).toHaveLength(0);
  });
});
