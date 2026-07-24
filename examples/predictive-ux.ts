/**
 * Phase 3 — Predictive UX.
 *
 * Extrapolate from a simulated population to what the wider user base will
 * experience — abandonment, confusion, onboarding failure, support contacts,
 * accessibility barriers — each with a confidence interval, plus the screens
 * predicted to cause struggle.
 *
 * Run:
 *   npx tsx examples/predictive-ux.ts
 */

import { simulatePopulation } from "../src/population/index.js";
import { predictUX, renderUXPredictionMarkdown } from "../src/predict/index.js";

// A first-time-user-heavy population, to exercise the onboarding prediction.
const study = await simulatePopulation({
  url: "mock:",
  size: 40,
  personas: ["first-time-user", "impatient-user", "elderly-user", "curious-explorer"],
  seed: 7,
  concurrency: 8,
});

const prediction = predictUX(study);
process.stdout.write(renderUXPredictionMarkdown(prediction) + "\n");
