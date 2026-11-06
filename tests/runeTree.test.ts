/**
 * Unit tests for the Rune tree-to-perception mapping.
 *
 * The mapping is the retina abstraction: only what a human perceives —
 * rendered visible text and geometry — may reach the operator. Internal
 * identifiers (element `key`, `path`) and the accessibility tree's internal
 * states never cross it. Fixtures are the real `--tree` dumps captured in
 * the Rune headless spike.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  downscaleToViewport,
  type RuneTree,
  runeTreeToVisibleElements,
} from "../src/browser/rune.js";

function loadFixture(name: string): RuneTree {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as RuneTree;
}

const OFF = loadFixture("rune-hello-off.json");
const ON = loadFixture("rune-hello-on.json");

describe("runeTreeToVisibleElements", () => {
  it("reports the off state as two perceived elements", () => {
    const elements = runeTreeToVisibleElements(OFF);
    // The window background group and the switch's knob sub-part are not
    // separate affordances a human perceives, so they are excluded.
    expect(elements).toHaveLength(2);

    const label = elements.find((el) => el.role === "text");
    expect(label).toMatchObject({
      text: "Lights off",
      textSource: "visual",
      box: { x: 130.25, y: 72.75, width: 59.5, height: 16.5 },
      interactive: false,
      color: "#eff0f2",
    });
    // The label's own fill is transparent black, not the background it sits
    // on, so no background color is reported; the pixel-sampled check
    // measures the real background instead.
    expect(label?.backgroundColor).toBeUndefined();

    const toggle = elements.find((el) => el.role === "checkbox");
    expect(toggle).toMatchObject({
      // "Lights" is the switch's accessible name, not rendered text: the
      // textSource flag marks it as not sight-visible, mirroring how the
      // perception script treats aria-label fallbacks.
      text: "Lights",
      textSource: "accessibility",
      box: { x: 141, y: 105.25, width: 38, height: 22 },
      interactive: true,
      focused: false,
      backgroundColor: "#ffffff",
    });
  });

  it("reports the on state with the switch visibly on", () => {
    const elements = runeTreeToVisibleElements(ON);
    expect(elements).toHaveLength(2);

    const label = elements.find((el) => el.role === "text");
    expect(label?.text).toBe("Lights on");

    const toggle = elements.find((el) => el.role === "checkbox");
    expect(toggle).toMatchObject({
      focused: true,
      backgroundColor: "#4392f7",
    });
  });

  it("never leaks internal identifiers into perception", () => {
    for (const tree of [OFF, ON]) {
      for (const el of runeTreeToVisibleElements(tree)) {
        expect(el).not.toHaveProperty("key");
        expect(el).not.toHaveProperty("path");
      }
    }
  });

  it("excludes hidden, inert, and off-viewport elements", () => {
    const tree: RuneTree = {
      title: "Synthetic",
      viewport: [320, 200],
      elements: [
        { role: "text", rect: [10, 10, 50, 10], text: "visible", opacity: 1 },
        { role: "text", rect: [10, 30, 50, 10], text: "hidden", opacity: 0 },
        { role: "text", rect: [10, 50, 50, 10], text: "inert", inert: true },
        { role: "text", rect: [400, 10, 50, 10], text: "offscreen" },
        { role: "group", rect: [0, 0, 320, 200] },
      ],
    };
    const elements = runeTreeToVisibleElements(tree);
    expect(elements.map((el) => el.text)).toEqual(["visible"]);
  });
});

describe("downscaleToViewport", () => {
  it("passes a viewport-sized PNG through untouched", () => {
    const image = new PNG({ width: 4, height: 2 });
    for (let i = 0; i < 4 * 2; i++) {
      image.data[i * 4] = 100;
      image.data[i * 4 + 1] = 150;
      image.data[i * 4 + 2] = 200;
      image.data[i * 4 + 3] = 255;
    }
    const png = PNG.sync.write(image);
    expect(downscaleToViewport(png, [4, 2])).toBe(png);
  });

  it("downscales a 2x image by box average", () => {
    const image = new PNG({ width: 4, height: 2 });
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (y * 4 + x) * 4;
        image.data[i] = x < 2 ? 200 : 20;
        image.data[i + 1] = 40;
        image.data[i + 2] = x < 2 ? 20 : 200;
        image.data[i + 3] = 255;
      }
    }
    const small = PNG.sync.read(downscaleToViewport(PNG.sync.write(image), [2, 1]));
    expect(small.width).toBe(2);
    expect(small.height).toBe(1);
    expect([small.data[0], small.data[1], small.data[2]]).toEqual([200, 40, 20]);
    expect([small.data[4], small.data[5], small.data[6]]).toEqual([20, 40, 200]);
  });
});
