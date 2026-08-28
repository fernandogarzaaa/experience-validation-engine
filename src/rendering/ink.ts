/**
 * First stage: turning pixels into "is there anything here".
 *
 * Everything downstream rests on one measurement — the *variance* of
 * luminance inside a small cell, rather than its brightness. Brightness says
 * what colour something is; variance says whether anything is drawn there.
 * A blank area of any colour has near-zero variance, the middle of a filled
 * button has near-zero variance, and glyph strokes against their background
 * have a lot of it. That single distinction is what lets EVE find rendered
 * content without knowing what the content is.
 *
 * The grid is coarse on purpose. Text at ordinary sizes still lands ink in
 * three or four cell rows, which is all the line-structure test needs, and a
 * 4px cell turns a million-pixel screenshot into ~60k cells — cheap enough to
 * run on every percept.
 */

import type { DecodedImage } from "../vision/pixels.js";
import { relativeLuminance } from "../vision/pixels.js";

/**
 * Edge of a cell, in **CSS** pixels.
 *
 * Every threshold downstream is counted in cells — how far a fill reaches to
 * bridge a word gap, how close two lines must be to form a block, how thin a
 * band has to be to read as one line of type. Those are facts about human
 * perception, so the cell has to be a fixed perceptual size. Defining it in
 * device pixels instead makes all of them shrink by half on a 2x display,
 * where words stop bridging into lines and a paragraph shatters into pieces.
 */
export const CELL = 4;

/**
 * Cell edge in device pixels for a given device-pixel ratio.
 *
 * Rounded, and never below 1: a fractional ratio still has to land on whole
 * pixels, and a zero-width cell would divide by zero downstream.
 */
export function cellFor(scale: number): number {
  return Math.max(1, Math.round(CELL * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

/**
 * Within-cell luminance variance above which a cell counts as carrying
 * rendered detail.
 *
 * Calibrated against antialiasing rather than against text: a flat fill still
 * varies slightly where the encoder rounded, and a cell clipping the edge of
 * a solid shape varies a great deal. This sits above the first and below the
 * second, so "ink" means detail *inside* the cell, not a boundary crossing it.
 */
export const INK_VARIANCE = 0.0025;

export interface InkGrid {
  /** Cell counts, not pixels. */
  readonly width: number;
  readonly height: number;
  /** Device pixels per cell. */
  readonly cell: number;
  /** Mean luminance per cell, 0..1. */
  readonly luminance: Float32Array;
  /** Luminance variance per cell. */
  readonly variance: Float32Array;
  /** 1 where the cell carries rendered detail. */
  readonly ink: Uint8Array;
}

/** Index a cell, row-major. */
export function cellIndex(grid: InkGrid, cx: number, cy: number): number {
  return cy * grid.width + cx;
}

/**
 * Reduce an image to a grid of luminance means and variances.
 *
 * Partial cells at the right and bottom edges are measured over the pixels
 * they actually contain, so a viewport whose size is not a multiple of the
 * cell does not grow a false band of low-variance cells along two edges.
 */
export function inkGrid(img: DecodedImage, cell: number = CELL): InkGrid {
  const width = Math.ceil(img.width / cell);
  const height = Math.ceil(img.height / cell);
  const luminance = new Float32Array(width * height);
  const variance = new Float32Array(width * height);
  const ink = new Uint8Array(width * height);

  for (let cy = 0; cy < height; cy++) {
    const y0 = cy * cell;
    const y1 = Math.min(y0 + cell, img.height);
    for (let cx = 0; cx < width; cx++) {
      const x0 = cx * cell;
      const x1 = Math.min(x0 + cell, img.width);

      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * img.width + x) * 4;
          const l = relativeLuminance(
            img.data[o] as number,
            img.data[o + 1] as number,
            img.data[o + 2] as number,
          );
          sum += l;
          sumSq += l * l;
          n++;
        }
      }

      const i = cy * width + cx;
      if (n === 0) continue;
      const mean = sum / n;
      // Clamped at zero: floating-point cancellation can make this very
      // slightly negative on a perfectly uniform cell.
      const v = Math.max(0, sumSq / n - mean * mean);
      luminance[i] = mean;
      variance[i] = v;
      ink[i] = v >= INK_VARIANCE ? 1 : 0;
    }
  }

  return { width, height, cell, luminance, variance, ink };
}

/**
 * The page's background luminance, as the most common luminance among cells
 * carrying no detail.
 *
 * A mean would be dragged toward whatever dominates the screen — a dark hero
 * image makes a white page look grey. The mode of the *blank* cells is the
 * colour the reader would call "the background", which is the thing every
 * later comparison is against. Quantised into 32 buckets so antialiasing
 * spread does not split one background across neighbouring bins.
 */
export function backgroundLuminance(grid: InkGrid): number {
  const BUCKETS = 32;
  const histogram = new Float64Array(BUCKETS);
  const counts = new Uint32Array(BUCKETS);

  for (let i = 0; i < grid.ink.length; i++) {
    if (grid.ink[i] === 1) continue;
    const l = grid.luminance[i] as number;
    const b = Math.min(BUCKETS - 1, Math.floor(l * BUCKETS));
    // `b` is clamped into range above; the assertions satisfy
    // noUncheckedIndexedAccess without a bounds check that cannot fail.
    histogram[b] = (histogram[b] as number) + l;
    counts[b] = (counts[b] as number) + 1;
  }

  let best = -1;
  let bestCount = 0;
  for (let b = 0; b < BUCKETS; b++) {
    if ((counts[b] as number) > bestCount) {
      bestCount = counts[b] as number;
      best = b;
    }
  }
  if (best < 0) return 1; // Every cell carries detail; assume a light page.
  return (histogram[best] as number) / (counts[best] as number);
}

/**
 * The cell range a box covers.
 *
 * Two readings are available and they disagree in a way that matters. Cells
 * *overlapping* the box include its neighbours' content, because a cell
 * straddling the boundary carries whatever is on both sides — the edge of the
 * button above bleeds into the paragraph below it. Cells *contained* by the
 * box see only the box's own pixels.
 *
 * Containment is the honest reading and is used wherever the question is
 * "what is drawn inside this element". It is unusable for a box smaller than
 * a cell, though, so the overlapping range is the fallback: better a slightly
 * contaminated measurement than none at all for every icon on the page.
 */
function cellRange(
  grid: InkGrid,
  box: { x: number; y: number; width: number; height: number },
): { cx0: number; cy0: number; cx1: number; cy1: number } | null {
  const inner = {
    cx0: Math.max(0, Math.ceil(box.x / grid.cell)),
    cy0: Math.max(0, Math.ceil(box.y / grid.cell)),
    cx1: Math.min(grid.width, Math.floor((box.x + box.width) / grid.cell)),
    cy1: Math.min(grid.height, Math.floor((box.y + box.height) / grid.cell)),
  };
  if (inner.cx1 > inner.cx0 && inner.cy1 > inner.cy0) return inner;

  const outer = {
    cx0: Math.max(0, Math.floor(box.x / grid.cell)),
    cy0: Math.max(0, Math.floor(box.y / grid.cell)),
    cx1: Math.min(grid.width, Math.ceil((box.x + box.width) / grid.cell)),
    cy1: Math.min(grid.height, Math.ceil((box.y + box.height) / grid.cell)),
  };
  return outer.cx1 > outer.cx0 && outer.cy1 > outer.cy0 ? outer : null;
}

/**
 * Share of cells carrying detail inside a device-pixel box, 0..1.
 *
 * This is the measurement behind "the DOM says there is a button here and
 * nothing is drawn there". Boxes falling entirely outside the grid return 0,
 * which reads correctly: nothing was rendered where the DOM said to look.
 */
export function inkDensity(
  grid: InkGrid,
  box: { x: number; y: number; width: number; height: number },
): number {
  const range = cellRange(grid, box);
  if (!range) return 0;

  let inked = 0;
  let total = 0;
  for (let cy = range.cy0; cy < range.cy1; cy++) {
    for (let cx = range.cx0; cx < range.cx1; cx++) {
      total++;
      if (grid.ink[cy * grid.width + cx] === 1) inked++;
    }
  }
  return total === 0 ? 0 : inked / total;
}

/** Mean luminance inside a device-pixel box, or the background when empty. */
export function meanLuminance(
  grid: InkGrid,
  box: { x: number; y: number; width: number; height: number },
  fallback: number,
): number {
  const range = cellRange(grid, box);
  if (!range) return fallback;

  let sum = 0;
  let n = 0;
  for (let cy = range.cy0; cy < range.cy1; cy++) {
    for (let cx = range.cx0; cx < range.cx1; cx++) {
      sum += grid.luminance[cy * grid.width + cx] as number;
      n++;
    }
  }
  return n === 0 ? fallback : sum / n;
}
