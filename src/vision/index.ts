export type { VisualIssue, VisualIssueKind } from "./analysis.js";
export {
  checkGeometry,
  checkPixels,
  checkRegression,
  simulateColorVision,
} from "./analysis.js";
export type { DecodedImage } from "./pixels.js";
export {
  contrastRatio,
  decodePng,
  frameDiffRatio,
  luminanceVariance,
  parseHexColor,
  pixelAt,
  relativeLuminance,
  sampleLuminances,
} from "./pixels.js";
