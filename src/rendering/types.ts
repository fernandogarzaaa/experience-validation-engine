import type { BoundingBox } from "../core/types.js";

/**
 * What a region of the screen looks like to someone who cannot read it yet —
 * the judgement made from a glance, before any text is recognised.
 *
 * These are perceptual categories, not semantic ones. EVE deliberately does
 * not OCR: to find content a human can see and the DOM cannot account for,
 * it is enough to establish that *something legible is rendered there*.
 * Reading it would tell EVE what the content says, which is not the question
 * being asked and would cost determinism to answer.
 */
export type RegionKind =
  /** Line-structured detail: horizontal bands of ink separated by clean gaps. */
  | "text"
  /** Detail without line structure — a photo, an illustration, a chart. */
  | "graphic"
  /** A flat area whose fill differs from the page around it: a filled control. */
  | "solid"
  /** Nothing perceptible. */
  | "blank";

/** A region of the rendered image, discovered from pixels alone. */
export interface PixelRegion {
  readonly kind: RegionKind;
  /** In CSS pixels, viewport-relative — the same space DOM boxes use. */
  readonly box: BoundingBox;
  /**
   * Share of the region's cells carrying rendered detail, 0..1. High for
   * text and photos, near zero for a flat fill.
   */
  readonly inkDensity: number;
  /**
   * How strongly the region shows horizontal line structure, 0..1. This is
   * what separates a paragraph from a photograph: text alternates bands of
   * ink and clean gaps at a regular pitch, and images do not.
   */
  readonly lineStructure: number;
  /** Mean luminance of the region, 0..1. */
  readonly luminance: number;
}

/** Everything perceived in one screenshot. */
export interface RenderingObservation {
  /** Regions carrying perceptible content, largest first. */
  readonly regions: readonly PixelRegion[];
  /** The page's dominant background luminance, 0..1. */
  readonly backgroundLuminance: number;
  /** Device pixels per CSS pixel, as measured from the screenshot. */
  readonly scale: number;
  /** The viewport the regions are expressed in, in CSS pixels. */
  readonly viewport: { readonly width: number; readonly height: number };
}
