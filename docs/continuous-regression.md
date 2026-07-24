# Continuous UX Regression (Phase 3)

Functional tests tell you the build still *works*. Continuous UX regression
tells you whether the **experience** is getting better or worse across builds —
even when every functional test stays green.

Where [`compareExperience`](panel-and-analysis.md) compares two sessions,
`analyzeTrends` operates on an ordered **series of population studies** (build 1
→ build N) and turns each tracked metric into a trend.

```ts
import { simulatePopulation, analyzeTrends, renderTrendReportMarkdown } from "experience-validation-engine";

const v1 = await simulatePopulation({ url: "https://staging.example.com?build=1", size: 30, seed: 7 });
const v2 = await simulatePopulation({ url: "https://staging.example.com?build=2", size: 30, seed: 7 });

const report = analyzeTrends([{ label: "v1", study: v1 }, { label: "v2", study: v2 }]);
console.log(report.verdict);   // "improving" | "regressing" | "mixed" | "stable"
console.log(renderTrendReportMarkdown(report));
```

## Tracked metrics

Each is trended with the correct direction of "good":

| Metric | Good direction |
|---|---|
| Success rate | higher |
| Drop-off rate | lower |
| Overall score | higher |
| Confidence | higher |
| Frustration | lower |
| Trust | higher |
| Median steps to complete | lower |

For each metric you get the full `series` across builds, the first/last values,
the raw `delta`, a least-squares `slope`, and a `direction`
(`improved` / `regressed` / `stable`, with a small relative epsilon so noise
reads as stable). The report rolls these up into `regressions`, `improvements`,
and an overall `verdict`.

## Via MCP

`eve_compare_builds` studies each build URL (oldest first) and returns the
trend report — so an AI coding agent can gate a deploy on "did the experience
regress?" See [integrations.md](integrations.md).

```jsonc
// arguments
{ "builds": [ { "url": "…?build=1", "label": "v1" }, { "url": "…?build=2", "label": "v2" } ],
  "goal": "sign up", "size": 30, "seed": 7 }
```

## As a CI gate

Run a study on the previous release and the candidate, `analyzeTrends`, and fail
the job if `report.regressions` is non-empty (or if `verdict === "regressing"`).
The same seed makes builds directly comparable.
