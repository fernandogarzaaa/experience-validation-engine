export {
  checkGeometry,
  checkPixels,
  checkRegression,
  simulateColorVision,
} from "./analysis.js";
export type { VisualIssue, VisualIssueKind } from "./analysis.js";
export {
  decodePng,
  frameDiffRatio,
  luminanceVariance,
  relativeLuminance,
  contrastRatio,
  parseHexColor,
  sampleLuminances,
  pixelAt,
} from "./pixels.js";
export type { DecodedImage } from "./pixels.js";
