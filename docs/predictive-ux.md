# Predictive UX (Phase 3)

Extrapolate from a simulated population to what the **wider user base** will
experience — with confidence intervals, so you can plan for the range, not just
a point estimate.

```ts
import { simulatePopulation, predictUX, renderUXPredictionMarkdown } from "experience-validation-engine";

const study = await simulatePopulation({ url: "mock:", size: 40, seed: 7 });
const prediction = predictUX(study);
console.log(renderUXPredictionMarkdown(prediction));
```

## What it predicts (`UXPrediction`)

| Prediction | How |
|---|---|
| Abandonment rate | Observed proportion + 95% Wilson interval |
| Confusion rate | Proportion lost/disoriented (confused-wanderers + high confusion) |
| Onboarding failure rate | First-time users who fail to activate |
| Accessibility-barrier rate | Accessibility-sensitive users who hit a barrier (or modeled from a11y findings) |
| Support contacts | **Modeled** per-100-users rate from frustration, abandonment, and broken-interaction prevalence (±30% band) |
| `struggleForecasts` | Screens predicted to cause confusion, ranked by risk |

Proportion predictions use the **Wilson score interval** (`wilsonInterval` is
exported) — more accurate than the normal approximation at small samples and
near 0 or 1. Each item declares its `basis` (`observed-proportion` vs
`modeled`) and `unit`, so nothing overstates its certainty. Deterministic.

## Via MCP

`eve_predict_ux` runs the population and returns the predictions in one call —
so an AI coding agent can forecast where and how much users will struggle
before shipping. See [integrations.md](integrations.md).

## Relationship to forecasting

This is the population-level companion to the Phase-2, session-level
[`forecastExperience`](panel-and-analysis.md): where forecasting reads a single
run's trajectory, predictive UX reads a whole population and attaches
statistical confidence intervals.
