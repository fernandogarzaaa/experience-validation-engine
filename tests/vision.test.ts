import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { DEFAULT_ACCESSIBILITY } from "../src/personas/index.js";
import {
  checkGeometry,
  checkRegression,
  contrastRatio,
  decodePng,
  frameDiffRatio,
  luminanceVariance,
  parseHexColor,
  relativeLuminance,
  simulateColorVision,
} from "../src/vision/index.js";

function el(overrides: Partial<VisibleElement>): VisibleElement {
  return {
    id: 0,
    role: "text",
    text: "sample text here",
    box: { x: 20, y: 20, width: 200, height: 24 },
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
    title: "Test",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs: [],
    loadingIndicator: false,
  };
}

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("pixel math", () => {
  it("WCAG contrast: black on white is 21:1", () => {
    const white = relativeLuminance(255, 255, 255);
    const black = relativeLuminance(0, 0, 0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
  });

  it("parses hex colors", () => {
    expect(parseHexColor("#ff8000")).toEqual([255, 128, 0]);
    expect(parseHexColor("nope")).toBeNull();
  });

  it("frame diff distinguishes identical and different frames", () => {
    const a = decodePng(solidPng(50, 50, [200, 200, 200]));
    const b = decodePng(solidPng(50, 50, [200, 200, 200]));
    const c = decodePng(solidPng(50, 50, [10, 10, 10]));
    expect(frameDiffRatio(a, b)).toBe(0);
    expect(frameDiffRatio(a, c)).toBe(1);
  });

  it("blank frames have near-zero luminance variance", () => {
    const blank = decodePng(solidPng(60, 60, [250, 250, 250]));
    expect(luminanceVariance(blank)).toBeLessThan(0.0001);
  });
});

describe("geometry checks", () => {
  it("flags low-contrast declared colors", () => {
    const issues = checkGeometry(
      percept([
        el({
          text: "faint label text",
          color: "#cccccc",
          backgroundColor: "#ffffff",
          fontSize: 14,
        }),
      ]),
      DEFAULT_ACCESSIBILITY,
    );
    expect(issues.some((i) => i.kind === "low-contrast")).toBe(true);
  });

  it("accepts high-contrast text", () => {
    const issues = checkGeometry(
      percept([
        el({ text: "clear label", color: "#111111", backgroundColor: "#ffffff", fontSize: 14 }),
      ]),
      DEFAULT_ACCESSIBILITY,
    );
    expect(issues.some((i) => i.kind === "low-contrast")).toBe(false);
  });

  it("flags tiny text against the persona's comfortable minimum", () => {
    const issues = checkGeometry(percept([el({ text: "tiny print", fontSize: 8 })]), {
      ...DEFAULT_ACCESSIBILITY,
      minComfortableFontPx: 14,
    });
    expect(issues.some((i) => i.kind === "tiny-text")).toBe(true);
  });

  it("flags overlapping interactive controls", () => {
    const issues = checkGeometry(
      percept([
        el({
          id: 0,
          text: "Save",
          role: "button",
          interactive: true,
          box: { x: 10, y: 10, width: 100, height: 40 },
        }),
        el({
          id: 1,
          text: "Cancel",
          role: "button",
          interactive: true,
          box: { x: 20, y: 15, width: 100, height: 40 },
        }),
      ]),
      DEFAULT_ACCESSIBILITY,
    );
    expect(issues.some((i) => i.kind === "overlapping-elements")).toBe(true);
  });

  it("red/green distinctions collapse under deuteranopia", () => {
    const red = simulateColorVision([220, 40, 40], "deuteranopia");
    const green = simulateColorVision([40, 180, 40], "deuteranopia");
    const distance = Math.hypot(red[0] - green[0], red[1] - green[1], red[2] - green[2]);
    const originalDistance = Math.hypot(220 - 40, 40 - 180, 40 - 40);
    expect(distance).toBeLessThan(originalDistance * 0.5);
  });
});

describe("checkRegression", () => {
  it("flags a major visual regression when pixels churn a lot but the text didn't change", () => {
    const previous = solidPng(50, 50, [200, 200, 200]);
    const current = solidPng(50, 50, [10, 10, 10]); // frameDiffRatio 1, well over the 0.35 gate
    const issue = checkRegression(previous, current, true);

    expect(issue).not.toBeNull();
    expect(issue?.kind).toBe("visual-regression");
    expect(issue?.severityHint).toBe("major");
    expect(issue?.detail).toContain("100%");
  });

  it("does not flag identical frames", () => {
    const previous = solidPng(50, 50, [200, 200, 200]);
    const current = solidPng(50, 50, [200, 200, 200]);
    expect(checkRegression(previous, current, true)).toBeNull();
  });

  it("does not flag pixel churn when the visible text also changed", () => {
    // Large pixel diff is expected when the content itself is different —
    // that's a normal navigation, not layout instability.
    const previous = solidPng(50, 50, [200, 200, 200]);
    const current = solidPng(50, 50, [10, 10, 10]);
    expect(checkRegression(previous, current, false)).toBeNull();
  });

  it("does not flag a moderate pixel diff below the regression threshold", () => {
    // A soft gradient-ish shift that stays under the 0.35 diff gate.
    const previous = solidPng(50, 50, [200, 200, 200]);
    const current = solidPng(50, 50, [195, 195, 195]);
    expect(checkRegression(previous, current, true)).toBeNull();
  });

  it("degrades to null rather than throwing on undecodable image data", () => {
    const garbage = Buffer.from([1, 2, 3, 4]);
    expect(checkRegression(garbage, garbage, true)).toBeNull();
  });
});
