/**
 * What kind of surface an adapter perceives.
 *
 * EVE's cognition is modality-agnostic — it reasons over a Percept. This
 * descriptor tells the reporting and plugin layers which perceptual
 * dimensions are meaningful, so a textual surface is never scored as if it
 * failed a visual audit.
 */
export interface SurfaceCapabilities {
  /** Pixel geometry and visual styling (font size, color, contrast) are meaningful. */
  readonly spatial: boolean;
  readonly modality: "visual" | "textual";
  readonly canScreenshot: boolean;
  readonly canGoBack: boolean;
  readonly canScroll: boolean;
}

/** A rendered browser page: full pixel geometry and styling. */
export const VISUAL_SURFACE: SurfaceCapabilities = {
  spatial: true,
  modality: "visual",
  canScreenshot: true,
  canGoBack: true,
  canScroll: true,
};

/**
 * A text surface (terminal, tool listing). Character-cell geometry is real,
 * but there is no font size, color, or screenshot to perceive.
 */
export const TEXTUAL_SURFACE: SurfaceCapabilities = {
  spatial: false,
  modality: "textual",
  canScreenshot: false,
  canGoBack: false,
  canScroll: true,
};
