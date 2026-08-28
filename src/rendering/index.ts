/**
 * Rendering truth — what reached the screen, against what the page claims.
 *
 * EVE's perception script reads the DOM, which is what the page *says* about
 * itself. This module reads the rendering, which is what a person actually
 * sees. Neither is a substitute for the other: the DOM is exact about
 * structure and is what assistive technology consumes, while the pixels are
 * the only evidence of what reached the screen. The findings live in the gap
 * between them.
 *
 * See `docs/rendering.md` for the design and the reasoning behind each threshold.
 */

export {
  backgroundLuminance,
  CELL,
  cellFor,
  cellIndex,
  INK_VARIANCE,
  type InkGrid,
  inkDensity,
  inkGrid,
  meanLuminance,
} from "./ink.js";
export {
  abbreviate,
  inspect,
  observe,
  type RenderingIssue,
  type RenderingIssueKind,
  reconcile,
} from "./reconcile.js";
export { findRegions } from "./regions.js";
export type { PixelRegion, RegionKind, RenderingObservation } from "./types.js";
