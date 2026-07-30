/**
 * Predictive UX — extrapolate from a population to future confusion,
 * abandonment, onboarding failure, support contacts, and accessibility issues,
 * with confidence intervals.
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
