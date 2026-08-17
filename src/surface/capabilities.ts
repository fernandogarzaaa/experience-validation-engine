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
  /** How the operator actuates: a persistent mouse cursor, or discrete touches. */
  readonly pointer: "mouse" | "touch";
  /** Whether hover-revealed content is reachable at all on this surface. */
  readonly canHover: boolean;
  /**
   * Phase 2: the surface's native action-verb registry — the vocabulary a
   * cognition policy may use in kernel-native `invoke` actions
   * (`src/core/kernel.ts`). Verbs must be registered in
   * `actionVerbRegistry` (`src/protocol/verbs.ts`). When omitted, the
   * surface speaks the eleven legacy browser action kinds (the deprecated
   * web view's vocabulary); see {@link actionVerbsFor}.
   */
  readonly actionVerbs?: readonly string[];
}

/**
 * The eleven legacy browser action kinds — the default verb vocabulary of
 * every surface that predates the kernel (web, mobile, CLI, mock).
 */
export const LEGACY_WEB_VERBS = [
  "click",
  "doubleClick",
  "hover",
  "type",
  "press",
  "scroll",
  "navigate",
  "back",
  "read",
  "wait",
  "abandon",
] as const;

/** The verbs a surface actuates natively (declared, or the legacy web set). */
export function actionVerbsFor(capabilities: SurfaceCapabilities): readonly string[] {
  return capabilities.actionVerbs ?? LEGACY_WEB_VERBS;
}

/** A rendered browser page: full pixel geometry and styling, driven by a mouse. */
export const VISUAL_SURFACE: SurfaceCapabilities = {
  spatial: true,
  modality: "visual",
  canScreenshot: true,
  canGoBack: true,
  canScroll: true,
  pointer: "mouse",
  canHover: true,
};

/**
 * A text surface (terminal, tool listing). Character-cell geometry is real,
 * but there is no font size, color, or screenshot to perceive. Pointer/hover
 * are not meaningful here (no rendered surface to point at); "mouse"/false
 * are inert defaults, mirroring how `spatial: false` makes `canScreenshot`
 * moot rather than describing a real capability.
 */
export const TEXTUAL_SURFACE: SurfaceCapabilities = {
  spatial: false,
  modality: "textual",
  canScreenshot: false,
  canGoBack: false,
  canScroll: true,
  pointer: "mouse",
  canHover: false,
};

/**
 * A rendered mobile page: full pixel geometry and styling, but actuated by
 * touch. There is no persistent pointer, so hover-revealed content is
 * genuinely unreachable — not merely awkward to reach.
 */
export const TOUCH_VISUAL_SURFACE: SurfaceCapabilities = {
  spatial: true,
  modality: "visual",
  canScreenshot: true,
  canGoBack: true,
  canScroll: true,
  pointer: "touch",
  canHover: false,
};
