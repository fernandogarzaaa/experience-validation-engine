/**
 * Predictive UX — extrapolate from a population to future confusion,
 * abandonment, onboarding failure, support contacts, and accessibility issues,
 * with confidence intervals.
 */

export {
  predictUX,
  wilsonInterval,
  type UXPrediction,
  type UXPredictionItem,
  type PredictedStruggle,
  type PredictionBasis,
} from "./predict.js";
export { renderUXPredictionMarkdown } from "./report.js";
