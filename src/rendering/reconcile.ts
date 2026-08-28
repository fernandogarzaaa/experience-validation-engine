/**
 * The payoff: comparing what is drawn against what the page claims.
 *
 * EVE's perception script walks the DOM, so everything EVE knows about a page
 * is what the page says about itself. That is the right default — it is fast,
 * exact, and it is also what assistive technology reads. But it is a claim,
 * not an observation, and the interesting failures are precisely where the
 * claim and the rendering disagree:
 *
 *   - the DOM offers a control that isn't drawn, so EVE would "click" a
 *     thing no person can see;
 *   - the DOM carries text that never reached the screen, because a
 *     stylesheet, a font, or an overlay ate it;
 *   - the screen carries content the DOM knows nothing about, because it was
 *     painted into a canvas or baked into an image — invisible to EVE, to a
 *     screen reader, and to every DOM-based testing tool.
 *
 * The last one is the reason this module exists. No DOM-only tool can see it,
 * because there is nothing in the DOM to see.
 *
 * Every check below is deliberately conservative: a wrong finding here tells
 * someone their working page is broken, which is worse than staying quiet.
 * Where a signal is ambiguous, nothing is reported.
 */

import type { BoundingBox, Percept, Viewport, VisibleElement } from "../core/types.js";
import { decodePng } from "../vision/pixels.js";
import {
  backgroundLuminance,
  cellFor,
  type InkGrid,
  inkDensity,
  inkGrid,
  meanLuminance,
} from "./ink.js";
import { findRegions } from "./regions.js";
import type { RenderingObservation } from "./types.js";

export type RenderingIssueKind =
  /** The DOM offers an interactive element; nothing is rendered where it sits. */
  | "phantom-control"
  /** The DOM carries text; the pixels in its box are blank. */
  | "unrendered-text"
  /** The screen carries content no DOM element accounts for. */
  | "unaccounted-content";

export interface RenderingIssue {
  readonly kind: RenderingIssueKind;
  readonly box: BoundingBox;
  /** One sentence, in the terms a person would use. */
  readonly detail: string;
  /** The DOM element involved, when the disagreement starts from one. */
  readonly elementId?: number;
  /** The element's text, when it has any — quoted as evidence. */
  readonly text?: string;
}

/**
 * Ink share below which a box counts as showing nothing.
 *
 * Not zero: antialiasing, a hairline border and JPEG-ish gradients all put a
 * little detail into an otherwise empty box, and a threshold of zero would
 * report every one of them as blank.
 */
const BLANK_INK = 0.02;

/**
 * Luminance difference from the page background below which a box is
 * indistinguishable from it.
 *
 * A filled button with no label carries almost no ink but is plainly visible,
 * so ink alone would call it a phantom. Contrast against the page is what
 * separates "nothing is drawn here" from "something flat is drawn here".
 */
const FLAT_CONTRAST = 0.06;

/** Regions smaller than this in CSS pixels are not worth a person's notice. */
const MIN_NOTICEABLE_AREA = 24 * 24;

/** Share of a region that must be covered by DOM boxes to count as accounted for. */
const ACCOUNTED_COVERAGE = 0.5;

/**
 * Decode, measure and segment a screenshot in one pass.
 *
 * The grid is returned alongside the observation because reconciliation needs
 * it too, and building it is the expensive part of looking at a screen. A
 * session takes a percept per step, so paying for it twice per step is a cost
 * worth one extra return value.
 */
function perceive(
  screenshot: Buffer | null,
  viewport: Viewport,
): { grid: InkGrid; observation: RenderingObservation } | null {
  if (!screenshot || viewport.width <= 0 || viewport.height <= 0) return null;

  let img: ReturnType<typeof decodePng>;
  try {
    img = decodePng(screenshot);
  } catch {
    return null;
  }
  if (img.width === 0 || img.height === 0) return null;

  // Measured, never assumed: mobile emulation renders at 2x or 3x, and a
  // check that assumed 1 would misplace every region it found. It is
  // established *before* gridding because the cell size depends on it.
  const scale = img.width / viewport.width;
  const grid = inkGrid(img, cellFor(scale));
  const background = backgroundLuminance(grid);
  const regions = findRegions(grid, scale, background);

  return {
    grid,
    observation: {
      regions,
      backgroundLuminance: background,
      scale,
      viewport: { width: viewport.width, height: viewport.height },
    },
  };
}

/** Perceive a screenshot. Returns null when there is nothing to look at. */
export function observe(
  screenshot: Buffer | null,
  viewport: Viewport,
): RenderingObservation | null {
  return perceive(screenshot, viewport)?.observation ?? null;
}

/** Area of the intersection of two boxes, in the units they share. */
function intersectionArea(a: BoundingBox, b: BoundingBox): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

/**
 * Whether an element sits wholly inside the viewport.
 *
 * Anything partly outside is skipped throughout: the screenshot stops at the
 * viewport edge, so the missing pixels are missing because they were never
 * captured, not because nothing was drawn. Reporting those would produce a
 * finding on every page with content below the fold.
 */
function fullyVisible(box: BoundingBox, viewport: Viewport): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height &&
    box.width > 0 &&
    box.height > 0
  );
}

/** Convert a CSS-pixel box to the device pixels the grid is measured in. */
function toDevice(box: BoundingBox, scale: number): BoundingBox {
  return {
    x: box.x * scale,
    y: box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/**
 * Shorten a quotation for a headline, preferring a word boundary.
 *
 * Cutting mid-word ("but invisib") reads as a rendering bug in the report
 * itself, which is a poor look for a tool whose whole subject is text that
 * did not come out right. Falls back to a hard cut when a single word is
 * longer than the budget.
 */
export function abbreviate(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Compare the rendering against the DOM's account of it.
 *
 * Takes the observation rather than re-deriving it so a caller that already
 * looked at this screenshot does not pay for the grid twice.
 */
export function reconcile(percept: Percept, observation: RenderingObservation): RenderingIssue[] {
  if (!percept.screenshot) return [];
  let img: ReturnType<typeof decodePng>;
  try {
    img = decodePng(percept.screenshot);
  } catch {
    return [];
  }
  return reconcileWith(percept, observation, inkGrid(img, cellFor(observation.scale)));
}

function reconcileWith(
  percept: Percept,
  observation: RenderingObservation,
  grid: InkGrid,
): RenderingIssue[] {
  const background = observation.backgroundLuminance;
  const scale = observation.scale;
  const viewport = percept.viewport;
  const issues: RenderingIssue[] = [];

  const candidates = percept.elements.filter((el) => fullyVisible(el.box, viewport));

  // --- What the DOM claims but the screen does not show -------------------
  for (const el of candidates) {
    const device = toDevice(el.box, scale);
    const density = inkDensity(grid, device);
    if (density > BLANK_INK) continue;

    const luminance = meanLuminance(grid, device, background);
    const distinct = Math.abs(luminance - background) > FLAT_CONTRAST;

    if (el.text.trim().length > 0) {
      // Text is not text unless it is drawn. A flat fill where a label should
      // be is still a failure — the fill is visible, the words are not.
      issues.push({
        kind: "unrendered-text",
        box: el.box,
        elementId: el.id,
        text: el.text,
        detail: distinct
          ? `The DOM carries the text "${abbreviate(el.text)}" here, but the area is a flat fill with nothing drawn in it — the text did not reach the screen.`
          : `The DOM carries the text "${abbreviate(el.text)}" here, but nothing is rendered in its box.`,
      });
      continue;
    }

    // A filled control with no label is visible, so only a box that is also
    // indistinguishable from the page counts as a phantom.
    if (el.interactive && !el.disabled && !distinct) {
      issues.push({
        kind: "phantom-control",
        box: el.box,
        elementId: el.id,
        detail: `The DOM offers ${describe(el)} here, but nothing is drawn at that position — a person would not know it exists.`,
      });
    }
  }

  // --- What the screen shows but the DOM does not account for -------------
  const domBoxes = percept.elements.map((el) => el.box);
  for (const region of observation.regions) {
    if (region.kind !== "text" && region.kind !== "graphic") continue;
    const area = region.box.width * region.box.height;
    if (area < MIN_NOTICEABLE_AREA) continue;
    if (!fullyVisible(region.box, viewport)) continue;

    // Coverage is summed over DOM boxes, which may overlap each other; the
    // sum is therefore an over-estimate of true coverage. That bias is the
    // safe direction — it can only make this check quieter, never noisier.
    let covered = 0;
    for (const box of domBoxes) {
      covered += intersectionArea(region.box, box);
      if (covered >= area * ACCOUNTED_COVERAGE) break;
    }
    if (covered >= area * ACCOUNTED_COVERAGE) continue;

    issues.push({
      kind: "unaccounted-content",
      box: region.box,
      detail:
        region.kind === "text"
          ? `A person can see text rendered here that no element in the page accounts for — drawn into a canvas or baked into an image. EVE cannot read it, and neither can a screen reader.`
          : `A person can see content rendered here that no element in the page accounts for. Whatever it conveys is unavailable to anything that reads the page rather than looks at it.`,
    });
  }

  return issues;
}

/** Name an element the way a person would refer to it. */
function describe(el: VisibleElement): string {
  const article = el.role === "image" ? "an" : "a";
  return `${article} ${el.role}`;
}

/** Perceive and reconcile in one step, for callers holding only a percept. */
export function inspect(percept: Percept): {
  observation: RenderingObservation | null;
  issues: readonly RenderingIssue[];
} {
  const seen = perceive(percept.screenshot, percept.viewport);
  if (!seen) return { observation: null, issues: [] };
  return {
    observation: seen.observation,
    issues: reconcileWith(percept, seen.observation, seen.grid),
  };
}
