# Predictive UX (Phase 3)

Simulation estimates from a simulated population — with HONEST uncertainty
labels. These numbers describe what EVE's simulated operators did, NOT what
the wider user base will experience: simulated personas are not a random
sample of real users, so no population inference is claimed. Every item
carries `provenance` (`derived` / `heuristic`), `calibrationStatus`
(`uncalibrated-heuristic` until fitted against real human data), and a
`humanCalibratedEstimate` (null until calibration exists).

```ts
import { simulatePopulation, predictUX, renderUXPredictionMarkdown } from "experience-validation-engine";

const study = await simulatePopulation({ url: "mock:", size: 40, seed: 7 });
const prediction = predictUX(study);
console.log(renderUXPredictionMarkdown(prediction));
```

## What it predicts (`UXPrediction`)

| Prediction | How |
|---|---|
| Abandonment rate | Simulation-sample proportion + 95% Wilson interval **over the simulation sample only (not a real-user CI)** |
| Confusion rate | Heuristic confusion-risk index over simulated operators (not a probability) |
| Onboarding failure rate | First-time simulated users who fail to activate |
| Accessibility-barrier rate | Accessibility-sensitive simulated users who hit a barrier (or modeled from a11y findings) |
| Support contacts (heuristic operational estimate) | **Heuristic** per-100-users scenario score from frustration, abandonment, and broken-interaction prevalence (±30% display band, not a fitted variance). No empirical link to real support contacts — replace via calibration once real support data exists |
| `struggleForecasts` | Screens flagged by the heuristic confusion-risk index, ranked (indices, not probabilities) |

Proportion ranges use the **Wilson score interval** (`wilsonInterval` is
exported) — more accurate than the normal approximation at small samples and
near 0 or 1. The interval quantifies uncertainty about the SIMULATION sample
only. Each item declares its `basis` (`observed-proportion` vs `modeled`),
`unit`, `provenance`, and `calibrationStatus`, so nothing overstates its
certainty. Deterministic.

## Via MCP

`eve_predict_ux` runs the population and returns the predictions in one call —
so an AI coding agent can forecast where and how much users will struggle
before shipping. See [integrations.md](integrations.md).

## Relationship to forecasting

This is the population-level companion to the Phase-2, session-level
[`forecastExperience`](panel-and-analysis.md): where forecasting reads a single
run's trajectory, predictive UX reads a whole population and attaches
statistical confidence intervals.
