/**
 * Second stage: grouping ink into regions and saying what each
 * one looks like.
 *
 * It runs in two passes, because the unit a person perceives is not the unit
 * a flood fill finds.
 *
 * The fill bridges a small horizontal gap, so a row of words becomes one line
 * rather than five disconnected blobs. It deliberately does not bridge
 * vertically — the space between lines is genuinely blank — which leaves every
 * line its own blob. That is the wrong unit twice over: line rhythm is a
 * property of a block of type and cannot be seen from a single line, and a
 * reader looking at a chart sees one chart, not four captions.
 *
 * So a second pass assembles lines into blocks, joining those that sit close
 * and share a margin. Only then is it meaningful to ask whether a region has
 * the rhythm of set type.
 */

import type { BoundingBox } from "../core/types.js";
import { type InkGrid, inkDensity, meanLuminance } from "./ink.js";
import type { PixelRegion, RegionKind } from "./types.js";

/**
 * Cells of blank space a fill will cross horizontally.
 *
 * Three cells at 4px is 12 device pixels — wider than an inter-word space at
 * ordinary sizes, narrower than the gutter between two columns. Raising it
 * merges columns; lowering it splits sentences into words.
 */
const H_BRIDGE = 3;

/**
 * Cell rows of clear space across which two blobs still belong together.
 *
 * The fill bridges words into a line but deliberately not lines into a block,
 * because the gap between lines is genuinely blank. That leaves every line its
 * own blob — and line rhythm is a property of a *block* of type, invisible to
 * anything looking at one line. So blocks are assembled here instead, from
 * lines that sit close and share a margin.
 *
 * Four cells is 16 device pixels: wider than the leading inside a paragraph at
 * ordinary sizes, narrower than the margin between two of them. The effect is
 * that a paragraph becomes one region while remaining separate from the next,
 * which is also how a reader would divide the page.
 */
const V_JOIN = 4;

/** Share of the narrower blob's width that must overlap for two to be one block. */
const COLUMN_OVERLAP = 0.5;

/** Regions smaller than this are noise: a bullet, an icon edge, a stray glyph. */
const MIN_CELLS = 6;

/** Above this share of inked cells in its own rows, a band counts as ink. */
const BAND_INK = 0.12;

/**
 * A region's cells, accumulated during the fill.
 *
 * Row occupancy is kept alongside the bounding box because line structure is
 * a fact about *rows*, and recovering it from the box afterwards would mean
 * a second pass over the grid.
 */
interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cells: number;
  /** Inked cells per grid row, indexed by absolute row. */
  readonly rowInk: Map<number, number>;
}

/**
 * Find connected areas of ink.
 *
 * Iterative rather than recursive: a full-screen photograph is one region of
 * tens of thousands of cells, and recursion would overflow the stack on a
 * perfectly ordinary page.
 */
function findBlobs(grid: InkGrid): Blob[] {
  const seen = new Uint8Array(grid.width * grid.height);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let startY = 0; startY < grid.height; startY++) {
    for (let startX = 0; startX < grid.width; startX++) {
      const start = startY * grid.width + startX;
      if (seen[start] === 1 || grid.ink[start] === 0) continue;

      const blob: Blob = {
        minX: startX,
        minY: startY,
        maxX: startX,
        maxY: startY,
        cells: 0,
        rowInk: new Map(),
      };
      seen[start] = 1;
      stack.push(start);

      while (stack.length > 0) {
        const index = stack.pop() as number;
        const x = index % grid.width;
        const y = (index - x) / grid.width;

        blob.cells++;
        if (x < blob.minX) blob.minX = x;
        if (x > blob.maxX) blob.maxX = x;
        if (y < blob.minY) blob.minY = y;
        if (y > blob.maxY) blob.maxY = y;
        blob.rowInk.set(y, (blob.rowInk.get(y) ?? 0) + 1);

        // Vertical and horizontal neighbours, plus a horizontal reach across
        // small gaps so a line of words stays one region.
        for (let dx = -H_BRIDGE; dx <= H_BRIDGE; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= grid.width || dx === 0) continue;
          const n = y * grid.width + nx;
          if (seen[n] === 1 || grid.ink[n] === 0) continue;
          seen[n] = 1;
          stack.push(n);
        }
        for (const dy of [-1, 1]) {
          const ny = y + dy;
          if (ny < 0 || ny >= grid.height) continue;
          const n = ny * grid.width + x;
          if (seen[n] === 1 || grid.ink[n] === 0) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }

      if (blob.cells >= MIN_CELLS) blobs.push(blob);
    }
  }

  return blobs;
}

/** Fold `b` into `a`, in place. */
function absorb(a: Blob, b: Blob): void {
  a.minX = Math.min(a.minX, b.minX);
  a.minY = Math.min(a.minY, b.minY);
  a.maxX = Math.max(a.maxX, b.maxX);
  a.maxY = Math.max(a.maxY, b.maxY);
  a.cells += b.cells;
  for (const [row, count] of b.rowInk) a.rowInk.set(row, (a.rowInk.get(row) ?? 0) + count);
}

/**
 * Assemble lines into blocks.
 *
 * Two blobs join when they are vertically close and horizontally aligned —
 * the second condition matters as much as the first, or a caption would
 * absorb the unrelated control sitting beside it. Blobs are taken in reading
 * order so a block grows downward one line at a time, which is also the order
 * that makes a single pass sufficient.
 */
function groupIntoBlocks(blobs: Blob[]): Blob[] {
  const ordered = [...blobs].sort((a, b) =>
    a.minY !== b.minY ? a.minY - b.minY : a.minX - b.minX,
  );
  const blocks: Blob[] = [];

  for (const blob of ordered) {
    let merged = false;
    for (const block of blocks) {
      const gap = blob.minY - block.maxY - 1;
      if (gap > V_JOIN || gap < -Math.max(1, block.maxY - block.minY + 1)) continue;

      const overlap = Math.min(block.maxX, blob.maxX) - Math.max(block.minX, blob.minX) + 1;
      const narrower = Math.min(block.maxX - block.minX + 1, blob.maxX - blob.minX + 1);
      if (overlap <= 0 || overlap / narrower < COLUMN_OVERLAP) continue;

      absorb(block, blob);
      merged = true;
      break;
    }
    if (!merged) {
      blocks.push({ ...blob, rowInk: new Map(blob.rowInk) });
    }
  }

  return blocks;
}

/**
 * How strongly a region alternates inked bands with clean gaps, 0..1.
 *
 * This is the whole basis for telling writing apart from imagery without
 * reading it. Set text has a rhythm — a band of glyphs, a clean gap, another
 * band — repeating at the line pitch. A photograph carries ink in nearly
 * every row and produces almost no gaps; a single short label produces one
 * band and no rhythm, which is why a lone band scores moderate rather than
 * high.
 */
function lineStructure(blob: Blob): number {
  const rows = blob.maxY - blob.minY + 1;
  const spanCells = blob.maxX - blob.minX + 1;
  if (rows < 1 || spanCells < 1) return 0;

  // Classify each row as inked or clear, relative to the region's own width.
  const inked: boolean[] = [];
  for (let y = blob.minY; y <= blob.maxY; y++) {
    const count = blob.rowInk.get(y) ?? 0;
    inked.push(count / spanCells >= BAND_INK);
  }

  // Measure the bands themselves. Type sets in thin bands of consistent
  // height; a photograph has one tall band, and a UI chrome strip has one
  // short one that spans the full width.
  const bandHeights: number[] = [];
  let run = 0;
  for (const on of inked) {
    if (on) {
      run++;
    } else if (run > 0) {
      bandHeights.push(run);
      run = 0;
    }
  }
  if (run > 0) bandHeights.push(run);
  if (bandHeights.length === 0) return 0;

  const tallest = Math.max(...bandHeights);
  const wideEnough = spanCells >= tallest * 3;

  if (bandHeights.length === 1) {
    // One line of type: thin, and much wider than it is tall. This is the
    // common case for a heading, a label, or a button caption, and it must
    // not be mistaken for a picture just because it lacks a neighbour.
    const thin = tallest <= 12; // ≤48 device px: one line at any ordinary size
    return thin && wideEnough ? 0.62 : 0.2;
  }

  // Several bands: the rhythm is the evidence. Consistent band heights mean
  // set type; wildly varying ones mean a picture that happens to have gaps.
  const mean = bandHeights.reduce((a, b) => a + b, 0) / bandHeights.length;
  const spread = bandHeights.reduce((a, b) => a + Math.abs(b - mean), 0) / bandHeights.length;
  const consistency = mean > 0 ? Math.max(0, 1 - spread / mean) : 0;

  const clearRows = inked.filter((v) => !v).length;
  const gapShare = clearRows / rows;
  // Text spends a meaningful minority of its rows in gaps. Both extremes —
  // solid ink, or mostly empty — are something else.
  const rhythm = gapShare > 0 && gapShare < 0.7 ? 1 - Math.abs(gapShare - 0.3) / 0.4 : 0;

  const score = 0.45 * Math.max(0, Math.min(1, rhythm)) + 0.55 * consistency;
  return wideEnough ? Math.max(0, Math.min(1, score)) : score * 0.5;
}

/** Decide what a region looks like from its density, rhythm and contrast. */
function classify(density: number, structure: number, contrastWithPage: number): RegionKind {
  if (density < 0.08) return contrastWithPage > 0.08 ? "solid" : "blank";
  if (structure >= 0.5) return "text";
  // Dense, unstructured detail is imagery. Sparse but present detail with
  // some rhythm is more likely a short label than a picture.
  if (density > 0.55) return "graphic";
  return structure >= 0.3 ? "text" : "graphic";
}

/**
 * Discover what is rendered, in CSS-pixel coordinates.
 *
 * `scale` converts device pixels to CSS pixels. It is not assumed to be 1:
 * mobile emulation renders at 2x or 3x, and a check that reported device
 * pixels there would place every region at a fraction of its true position
 * and never match a DOM box again.
 */
export function findRegions(grid: InkGrid, scale: number, pageLuminance: number): PixelRegion[] {
  const regions: PixelRegion[] = [];

  for (const blob of groupIntoBlocks(findBlobs(grid))) {
    const devBox = {
      x: blob.minX * grid.cell,
      y: blob.minY * grid.cell,
      width: (blob.maxX - blob.minX + 1) * grid.cell,
      height: (blob.maxY - blob.minY + 1) * grid.cell,
    };

    const density = inkDensity(grid, devBox);
    const structure = lineStructure(blob);
    const luminance = meanLuminance(grid, devBox, pageLuminance);
    const kind = classify(density, structure, Math.abs(luminance - pageLuminance));

    const box: BoundingBox = {
      x: devBox.x / scale,
      y: devBox.y / scale,
      width: devBox.width / scale,
      height: devBox.height / scale,
    };

    regions.push({ kind, box, inkDensity: density, lineStructure: structure, luminance });
  }

  // Largest first, with a total order: area alone leaves ties, and an
  // unstable order would make findings shuffle between identical runs.
  regions.sort((a, b) => {
    const areaA = a.box.width * a.box.height;
    const areaB = b.box.width * b.box.height;
    if (areaB !== areaA) return areaB - areaA;
    if (a.box.y !== b.box.y) return a.box.y - b.box.y;
    return a.box.x - b.box.x;
  });

  return regions;
}
