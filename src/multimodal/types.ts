/**
 * Multimodal perception — recognizing higher-level visual constructs (icons,
 * charts, loading states, toasts, media, text-in-images, animations) from what
 * a human can actually see on screen.
 *
 * This stays inside EVE's human-perception boundary: cues are derived from the
 * rendered, visible `Percept` (EVE's "retina"), never from DOM internals,
 * routes, or source. The `MultimodalPerceptor` interface is the extension point
 * for richer backends (a real OCR/vision-language model can implement it), with
 * a deterministic heuristic perceptor as the default.
 */

import type { Percept } from "../core/types.js";

export type CueKind =
  | "icon"
  | "chart"
  | "media"
  | "loading"
  | "toast"
  | "text-in-image"
  | "animation";

export interface MultimodalCue {
  readonly kind: CueKind;
  readonly label: string;
  /** Whether the cue carries an accessible text label a human/AT could read. */
  readonly accessible: boolean;
}

export interface MultimodalCues {
  readonly screen: string;
  readonly cues: readonly MultimodalCue[];
}

/** Pluggable multimodal perceptor. */
export interface MultimodalPerceptor {
  readonly name: string;
  /** Perceive multimodal cues on one screen (with the previous for motion). */
  perceive(percept: Percept, previous?: Percept): MultimodalCues;
}

export interface MultimodalReport {
  readonly perceptor: string;
  readonly screensAnalyzed: number;
  readonly totalCues: number;
  readonly byKind: Readonly<Record<CueKind, number>>;
  /** Icons/charts/media with no accessible label — a perception risk. */
  readonly unlabeled: readonly { readonly kind: CueKind; readonly screen: string }[];
  readonly screensWithLoading: number;
  readonly toasts: readonly { readonly screen: string; readonly label: string }[];
  readonly generatedAt: string;
}
