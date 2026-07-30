/**
 * Multimodal perception — recognize icons, charts, media, loading states,
 * toasts, text-in-images, and animation from what a human can see, staying
 * inside EVE's human-perception boundary.
 */

export { analyzeMultimodal, analyzeScreens } from "./analyze.js";
export { DEFAULT_MULTIMODAL_PERCEPTOR, HeuristicMultimodalPerceptor } from "./perceptor.js";
export { renderMultimodalMarkdown } from "./report.js";
export type {
  CueKind,
  MultimodalCue,
  MultimodalCues,
  MultimodalPerceptor,
  MultimodalReport,
} from "./types.js";
