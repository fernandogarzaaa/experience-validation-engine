import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrowserAdapter, RawSnapshot } from "../src/browser/adapter.js";
import { findingCategoryRegistry } from "../src/core/findingCategories.js";
import type { Percept } from "../src/core/types.js";
import { EveSession } from "../src/engine/session.js";
import {
  abbreviate,
  cellFor,
  findRegions,
  inkGrid,
  inspect,
  observe,
} from "../src/rendering/index.js";
import { RENDERING_CATEGORY, RENDERING_DIMENSION } from "../src/rendering/vocabulary.js";
import { dimensionRegistry } from "../src/scoring/dimensions.js";
import { VISUAL_SURFACE } from "../src/surface/capabilities.js";
import { decodePng } from "../src/vision/pixels.js";

/**
 * Every fixture here is a real Chromium render, captured through EVE's own
 * perception script, not a synthetic image.
 *
 * That distinction did real work while this was being built. Hand-drawn PNGs
 * confirm whatever the author already believed about how text renders.
 * Chromium found four bugs a synthetic image would have agreed with:
 *
 *   1. the flood fill produced one blob per *line*, so the multi-line rhythm
 *      test could never fire and all prose classified as imagery;
 *   2. a canvas produced one finding per line of text in it, rather than one
 *      for the chart a reader actually sees;
 *   3. cell quantisation pulled the button above into the box below it,
 *      hiding a paragraph that was genuinely invisible on screen;
 *   4. thresholds counted in device pixels halved on a 2x display, shattering
 *      that same canvas into eight findings.
 *
 * `disagreements.html` and `clean.html` sit beside the captures so the pages
 * can be re-rendered if the fixtures ever need regenerating.
 */
const FIXTURES = join(import.meta.dirname, "fixtures", "rendering");

function loadPercept(name: string): Percept {
  const snap = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
  return {
    timestamp: 0,
    url: "file://fixture",
    title: snap.title,
    viewport: snap.viewport,
    scrollY: snap.scrollY,
    scrollHeight: snap.scrollHeight,
    screenshot: readFileSync(join(FIXTURES, `${name}.png`)),
    elements: snap.elements,
    dialogs: snap.dialogs,
    loadingIndicator: snap.loadingIndicator,
  };
}

describe("the rendering check, on a page whose DOM and rendering disagree", () => {
  const percept = loadPercept("disagreements-1x");
  const { issues, observation } = inspect(percept);

  it("finds text painted into a canvas, which no DOM-based tool can see", () => {
    const unaccounted = issues.filter((i) => i.kind === "unaccounted-content");
    expect(unaccounted).toHaveLength(1);

    // The canvas sits below the buttons and is 520x150 in the page.
    const found = unaccounted[0] as (typeof unaccounted)[number];
    expect(found.box.y).toBeGreaterThan(300);
    expect(found.box.width).toBeGreaterThan(200);
    expect(found.detail).toContain("screen reader");
  });

  it("reports the canvas as one region, not one finding per line", () => {
    // Four separate fillText calls. A reader sees one chart; four findings
    // for it would be noise, and was the behaviour before lines were
    // assembled into blocks.
    expect(issues.filter((i) => i.kind === "unaccounted-content")).toHaveLength(1);
  });

  it("catches a control the DOM offers but nothing draws", () => {
    const ghost = issues.find((i) => i.text?.includes("Cancel transfer"));
    expect(ghost).toBeDefined();
    expect(ghost?.kind).toBe("unrendered-text");
  });

  it("catches text present in the DOM but invisible on screen", () => {
    const vanished = issues.find((i) => i.text?.includes("invisible on screen"));
    expect(vanished).toBeDefined();
    expect(vanished?.kind).toBe("unrendered-text");
  });

  it("does not accuse the controls and copy that render correctly", () => {
    // "Open schedule" is a real, filled, labelled button on the same row as
    // the ghost. Reporting it would make the tool untrustworthy.
    expect(issues.some((i) => i.text?.includes("Open schedule"))).toBe(false);
    expect(issues.some((i) => i.text?.includes("Quarterly account summary"))).toBe(false);
    expect(issues).toHaveLength(3);
  });

  it("classifies rendered prose as text rather than imagery", () => {
    const regions = observation?.regions ?? [];
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.every((r) => r.kind === "text")).toBe(true);
  });

  it("gives every finding a box a person could be pointed at", () => {
    for (const issue of issues) {
      expect(issue.box.width).toBeGreaterThan(0);
      expect(issue.box.height).toBeGreaterThan(0);
      expect(issue.detail.length).toBeGreaterThan(20);
    }
  });
});

describe("the rendering check, on a page that renders what it claims", () => {
  const percept = loadPercept("clean-1x");
  const { issues } = inspect(percept);

  /**
   * The single most important property here. Telling someone their working
   * page is broken is a worse failure than staying quiet about a real
   * problem, because it is the one that makes them stop believing the tool.
   */
  it("says nothing at all", () => {
    expect(issues).toEqual([]);
  });

  it("is not silent because it saw nothing", () => {
    const observation = observe(percept.screenshot, percept.viewport);
    expect(observation?.regions.length).toBeGreaterThan(3);
  });

  it("does not mistake a decorative image for unaccounted content", () => {
    // The page has an <img>; its pixels are real content, but the DOM
    // accounts for them, so there is nothing to report.
    expect(issues.some((i) => i.kind === "unaccounted-content")).toBe(false);
  });
});

describe("device pixel ratio", () => {
  /**
   * The thresholds this reasons with — how far a fill reaches to bridge
   * a word gap, how close two lines must be to form a block — are facts about
   * human perception. Counting them in device pixels halved every one of them
   * on a 2x display, and a paragraph shattered into fragments: eight findings
   * for the one canvas that produces a single finding at 1x.
   */
  it("reaches the same conclusions at 1x and 2x", () => {
    const at1x = inspect(loadPercept("disagreements-1x"));
    const at2x = inspect(loadPercept("disagreements-2x"));

    expect(at2x.observation?.scale).toBe(2);
    expect(at1x.observation?.scale).toBe(1);

    expect(at2x.issues.map((i) => i.kind).sort()).toEqual(at1x.issues.map((i) => i.kind).sort());
    expect(at2x.issues).toHaveLength(3);
  });

  it("places 2x findings in CSS pixels, not device pixels", () => {
    const at1x = inspect(loadPercept("disagreements-1x"));
    const at2x = inspect(loadPercept("disagreements-2x"));

    const canvas1x = at1x.issues.find((i) => i.kind === "unaccounted-content");
    const canvas2x = at2x.issues.find((i) => i.kind === "unaccounted-content");

    // Same place on the page, whatever the display density. A check that
    // reported device pixels would put this at twice the coordinate.
    expect(Math.abs((canvas2x?.box.y ?? 0) - (canvas1x?.box.y ?? 0))).toBeLessThan(12);
    expect(Math.abs((canvas2x?.box.x ?? 0) - (canvas1x?.box.x ?? 0))).toBeLessThan(12);
  });

  it("keeps the cell a fixed perceptual size", () => {
    expect(cellFor(1)).toBe(4);
    expect(cellFor(2)).toBe(8);
    expect(cellFor(3)).toBe(12);
    // A nonsensical ratio falls back to 1x rather than to a degenerate cell:
    // a 1px cell would make every antialiased edge read as ink.
    expect(cellFor(0)).toBe(4);
    expect(cellFor(-2)).toBe(4);
    expect(cellFor(Number.NaN)).toBe(4);
    // A fractional ratio still has to land on whole pixels.
    expect(cellFor(1.5)).toBe(6);
    expect(cellFor(1.25)).toBe(5);
  });
});

describe("abbreviate", () => {
  it("prefers a word boundary over cutting mid-word", () => {
    expect(abbreviate("This paragraph is in the DOM but invisible on screen.", 40)).toBe(
      "This paragraph is in the DOM but…",
    );
  });

  it("leaves text that already fits alone", () => {
    expect(abbreviate("Cancel transfer", 40)).toBe("Cancel transfer");
  });

  it("collapses whitespace, as a reader sees it", () => {
    expect(abbreviate("  two   words\n", 40)).toBe("two words");
  });

  it("hard-cuts a single word longer than the budget", () => {
    expect(abbreviate("A".repeat(50), 10)).toBe(`${"A".repeat(10)}…`);
  });
});

describe("determinism", () => {
  /**
   * A contractual property at every tier of EVE's API. Perception that
   * shifted between runs would make a session unreplayable, which is the one
   * thing the whole engine is built not to do.
   */
  it("returns identical results for identical pixels", () => {
    const percept = loadPercept("disagreements-1x");
    const first = JSON.stringify(inspect(percept));
    for (let i = 0; i < 4; i++) {
      expect(JSON.stringify(inspect(percept))).toBe(first);
    }
  });

  it("orders regions totally, so equal-area regions cannot swap", () => {
    const percept = loadPercept("clean-1x");
    const a = observe(percept.screenshot, percept.viewport)?.regions ?? [];
    const b = observe(percept.screenshot, percept.viewport)?.regions ?? [];
    expect(a.map((r) => `${r.box.x},${r.box.y}`)).toEqual(b.map((r) => `${r.box.x},${r.box.y}`));
  });
});

describe("degenerate input", () => {
  const percept = loadPercept("clean-1x");

  it("perceives nothing when there is no screenshot", () => {
    expect(observe(null, percept.viewport)).toBeNull();
    expect(inspect({ ...percept, screenshot: null }).issues).toEqual([]);
  });

  it("survives a corrupt screenshot rather than throwing", () => {
    const junk = Buffer.from("this is not a png");
    expect(observe(junk, percept.viewport)).toBeNull();
    expect(inspect({ ...percept, screenshot: junk }).issues).toEqual([]);
  });

  it("perceives nothing for a zero-sized viewport", () => {
    expect(observe(percept.screenshot, { width: 0, height: 0 })).toBeNull();
  });

  it("reports no ink on a uniform image", () => {
    const img = decodePng(readFileSync(join(FIXTURES, "clean-1x.png")));
    const flat = {
      width: 40,
      height: 40,
      data: new Uint8Array(40 * 40 * 4).fill(255),
    };
    const grid = inkGrid(flat, cellFor(1));
    expect(grid.ink.every((v) => v === 0)).toBe(true);
    expect(findRegions(grid, 1, 1)).toEqual([]);
    // The real image, by contrast, has plenty.
    expect(inkGrid(img, cellFor(1)).ink.some((v) => v === 1)).toBe(true);
  });
});

/**
 * The rendering check inside a session.
 *
 * Driven by a fixture-backed adapter rather than a real browser, because
 * `npm test` never touches one — that constraint is what keeps it fast enough
 * to gate CI on. The percept is the same real Chromium capture the tests
 * above use, so what reaches the session here is what a real run would see.
 */
describe("session integration", () => {
  class FixtureAdapter implements BrowserAdapter {
    readonly name = "fixture";
    readonly capabilities = VISUAL_SURFACE;
    constructor(private readonly percept: Percept) {}
    async open(): Promise<void> {}
    async snapshot(): Promise<RawSnapshot> {
      const p = this.percept;
      return {
        url: p.url,
        title: p.title,
        viewport: p.viewport,
        scrollY: p.scrollY,
        scrollHeight: p.scrollHeight,
        elements: p.elements,
        dialogs: p.dialogs,
        loadingIndicator: p.loadingIndicator,
      };
    }
    async screenshot(): Promise<Buffer | null> {
      return this.percept.screenshot;
    }
    async moveMouse(): Promise<void> {}
    async clickAt(): Promise<void> {}
    async doubleClickAt(): Promise<void> {}
    async typeText(): Promise<void> {}
    async pressKey(): Promise<void> {}
    async scrollBy(): Promise<void> {}
    async goBack(): Promise<void> {}
    async navigate(): Promise<void> {}
    async close(): Promise<void> {}
  }

  async function runAgainst(fixture: string) {
    const session = new EveSession({
      adapter: new FixtureAdapter(loadPercept(fixture)),
      startUrl: "file://fixture",
      persona: "first-time-user",
      maxSteps: 3,
      seed: 7,
      screenshots: true,
    });
    return session.run();
  }

  it("reports what the check saw as findings on the session", async () => {
    const result = await runAgainst("disagreements-1x");
    const found = result.findings.filter((f) => f.category === RENDERING_CATEGORY);
    expect(found.length).toBeGreaterThan(0);
  });

  it("keeps distinct problems distinct rather than collapsing them", async () => {
    // Findings deduplicate on title and URL. Both invisible labels on this
    // page share a kind, so a constant headline would report two problems as
    // one — which it did, before the headline carried the text.
    const result = await runAgainst("disagreements-1x");
    const titles = result.findings
      .filter((f) => f.category === RENDERING_CATEGORY)
      .map((f) => f.title);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.some((t) => t.includes("Cancel transfer"))).toBe(true);
    expect(titles.some((t) => t.includes("This paragraph is in the DOM"))).toBe(true);
  });

  it("cites evidence on every finding, as the category requires", async () => {
    const result = await runAgainst("disagreements-1x");
    for (const finding of result.findings.filter((f) => f.category === RENDERING_CATEGORY)) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.evidence.some((e) => e.startsWith("Rendered at"))).toBe(true);
    }
  });

  it("treats content only eyes can reach as the serious case", async () => {
    const result = await runAgainst("disagreements-1x");
    const unaccounted = result.findings.find((f) => f.title.includes("only eyes can reach"));
    expect(unaccounted?.severity).toBe("major");
  });

  it("adds nothing on a page that renders what it claims", async () => {
    const result = await runAgainst("clean-1x");
    expect(result.findings.filter((f) => f.category === RENDERING_CATEGORY)).toEqual([]);
  });

  it("registers its dimension and category, evidence required", async () => {
    await runAgainst("disagreements-1x");
    const category = findingCategoryRegistry.get(RENDERING_CATEGORY);
    expect(category?.evidenceRequired).toBe(true);
    expect(category?.appliesTo).toEqual(["visual"]);
    expect(dimensionRegistry.has(RENDERING_DIMENSION)).toBe(true);
  });
});
