import { describe, expect, it } from "vitest";
import { CELL_WIDTH, LINE_HEIGHT, layoutTextFrame } from "../src/surface/textFrame.js";

describe("layoutTextFrame", () => {
  it("places each line at its row using character-cell geometry", () => {
    const out = layoutTextFrame({
      lines: ["hello", "world"],
      affordances: [],
      windowRows: 24,
      scrollLine: 0,
    });
    expect(out.elements).toHaveLength(2);
    expect(out.elements[0].box).toEqual({ x: 0, y: 0, width: 5 * CELL_WIDTH, height: LINE_HEIGHT });
    expect(out.elements[1].box.y).toBe(LINE_HEIGHT);
    expect(out.elements[1].text).toBe("world");
  });

  it("omits visual-only properties entirely", () => {
    const out = layoutTextFrame({ lines: ["x"], affordances: [], windowRows: 24, scrollLine: 0 });
    expect(out.elements[0].fontSize).toBeUndefined();
    expect(out.elements[0].color).toBeUndefined();
    expect(out.elements[0].backgroundColor).toBeUndefined();
  });

  it("marks affordances interactive and positions them by column", () => {
    const out = layoutTextFrame({
      lines: ["try: npm install"],
      affordances: [{ line: 0, column: 5, text: "npm install", role: "button", command: "npm install" }],
      windowRows: 24,
      scrollLine: 0,
    });
    const affordance = out.elements.find((el) => el.interactive);
    expect(affordance).toBeDefined();
    expect(affordance!.text).toBe("npm install");
    expect(affordance!.box.x).toBe(5 * CELL_WIDTH);
  });

  it("skips blank lines and reports scrollHeight over all lines", () => {
    const out = layoutTextFrame({
      lines: ["a", "   ", "b"],
      affordances: [],
      windowRows: 24,
      scrollLine: 0,
    });
    expect(out.elements).toHaveLength(2);
    expect(out.scrollHeight).toBe(3 * LINE_HEIGHT);
  });

  it("clips lines below the visible window", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const out = layoutTextFrame({ lines, affordances: [], windowRows: 10, scrollLine: 0 });
    expect(out.elements[0].clippedByViewport).toBe(false);
    expect(out.elements[20].clippedByViewport).toBe(true);
  });

  it("keeps surrounding text on a line that also contains an affordance", () => {
    const out = layoutTextFrame({
      lines: ["Run `restart-proxy` to start it."],
      affordances: [{ line: 0, column: 5, text: "restart-proxy", role: "button", command: "restart-proxy" }],
      windowRows: 24,
      scrollLine: 0,
    });
    const text = out.elements.map((el) => el.text).join(" ");
    expect(text).toContain("Run");
    expect(text).toContain("to start it.");
    expect(text).toContain("restart-proxy");
  });

  it("positions elements relative to the current scroll offset", () => {
    const out = layoutTextFrame({
      lines: ["a", "b", "c"],
      affordances: [],
      windowRows: 2,
      scrollLine: 1,
    });
    const visible = out.elements.find((el) => el.text === "b");
    expect(visible!.box.y).toBe(0);
    expect(visible!.clippedByViewport).toBe(false);
  });
});
