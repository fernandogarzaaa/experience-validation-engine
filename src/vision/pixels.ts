import { PNG } from "pngjs";
import type { BoundingBox } from "../core/types.js";

/**
 * Low-level pixel utilities. Everything in the vision module operates on
 * decoded screenshots — the same signal a human retina receives — plus the
 * element geometry from the percept.
 */

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major. */
  readonly data: Uint8Array;
}

export function decodePng(buffer: Buffer): DecodedImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

export function pixelAt(img: DecodedImage, x: number, y: number): [number, number, number] {
  const cx = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const idx = (cy * img.width + cx) * 4;
  return [img.data[idx] ?? 0, img.data[idx + 1] ?? 0, img.data[idx + 2] ?? 0];
}

/** WCAG relative luminance of an sRGB pixel. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function parseHexColor(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Sample luminances within a box (subsampled grid). Returns sorted values.
 */
export function sampleLuminances(
  img: DecodedImage,
  box: BoundingBox,
  gridSize = 12,
): number[] {
  const values: number[] = [];
  const x0 = Math.max(0, box.x);
  const y0 = Math.max(0, box.y);
  const x1 = Math.min(img.width - 1, box.x + box.width);
  const y1 = Math.min(img.height - 1, box.y + box.height);
  if (x1 <= x0 || y1 <= y0) return values;
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x = x0 + ((x1 - x0) * (gx + 0.5)) / gridSize;
      const y = y0 + ((y1 - y0) * (gy + 0.5)) / gridSize;
      const [r, g, b] = pixelAt(img, x, y);
      values.push(relativeLuminance(r, g, b));
    }
  }
  return values.sort((a, b) => a - b);
}

/**
 * Fraction of pixels that differ between two same-sized frames beyond a
 * per-channel threshold. The workhorse of visual-regression and
 * "did-anything-change" detection.
 */
export function frameDiffRatio(a: DecodedImage, b: DecodedImage, threshold = 24): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const total = a.width * a.height;
  if (total === 0) return 0;
  let changed = 0;
  // Subsample large frames for speed (every 2nd pixel each axis ≥ 1MP).
  const step = total > 1_000_000 ? 2 : 1;
  let sampled = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const idx = (y * a.width + x) * 4;
      const dr = Math.abs((a.data[idx] ?? 0) - (b.data[idx] ?? 0));
      const dg = Math.abs((a.data[idx + 1] ?? 0) - (b.data[idx + 1] ?? 0));
      const db = Math.abs((a.data[idx + 2] ?? 0) - (b.data[idx + 2] ?? 0));
      if (dr > threshold || dg > threshold || db > threshold) changed += 1;
      sampled += 1;
    }
  }
  return sampled === 0 ? 0 : changed / sampled;
}

/** Variance of luminance across the whole frame — blank screens are ~0. */
export function luminanceVariance(img: DecodedImage): number {
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / 10_000)));
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const [r, g, b] = pixelAt(img, x, y);
      const l = relativeLuminance(r, g, b);
      sum += l;
      sumSq += l * l;
      n += 1;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}
