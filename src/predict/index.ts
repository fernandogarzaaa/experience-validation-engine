/**
 * Predictive UX — heuristic simulation estimates from a population (NOT
 * population inference): confusion/abandonment ranges over the simulation
 * sample, a heuristic support-contact scenario score, accessibility
 * estimates, and confusion-risk indices. Every item carries explicit
 * provenance and calibration status.
 */

export {
  type PredictedStruggle,
  type PredictionBasis,
  predictUX,
  type UXPrediction,
  type UXPredictionItem,
  wilsonInterval,
} from "./predict.js";
export { renderUXPredictionMarkdown } from "./report.js";
