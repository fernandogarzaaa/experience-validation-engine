# Human Validation Engine (Phase 3)

The largest weakness of any simulation is realism. The **human validation
engine** imports anonymized human usability traces and scores how closely EVE's
simulated population matches them — so realism becomes something you *measure*
and improve, not something you assume.

```ts
import { simulatePopulation, calibrate, renderCalibrationMarkdown } from "experience-validation-engine";

const study = await simulatePopulation({ url: "https://staging.example.com", size: 40, seed: 7 });
const report = calibrate(humanStudy, study);
console.log(report.similarityScore);  // 0..100
console.log(renderCalibrationMarkdown(report));
```

## The human-study schema

Import any anonymized study as JSON (`importHumanStudy` validates it):

```jsonc
{
  "task": "sign up for an account",
  "traces": [
    {
      "completed": true,
      "path": ["/", "/signup", "/welcome"],   // screen ids the human visited
      "steps": 9,                               // optional (defaults to path.length)
      "durationMs": 42000,                      // optional
      "frustration": 0.2,                       // optional self-report (0..1)
      "confidence": 0.7,                        // optional self-report (0..1)
      "abandonedOn": "/signup"                  // optional (for abandoned traces)
    }
    // ... one object per human session
  ]
}
```

Only `completed` and `path` are required per trace. Everything else refines the
comparison when available.

## What it scores (`CalibrationReport`)

| Metric | Meaning |
|---|---|
| `similarityScore` | Composite realism, 0–100 (weighted over the available dimensions) |
| `behaviorSimilarity` | How closely completion & abandonment rates match |
| `navigationSimilarity` | Cosine similarity of transition-frequency vectors (path overlap) |
| `timingSimilarity` | How closely effort (median steps) matches |
| `frictionCorrelation` | Pearson correlation of **where** friction/abandonment concentrates, per screen (−1..1) |
| `frustrationAlignment` / `confidenceAlignment` | Closeness of aggregate self-reports (null if humans didn't report them) |

Metrics that can't be computed (e.g. no shared screens, or no self-reports) are
`null` and explained in `notes` — nothing is fabricated. **Lower dimensions are
the point**: they tell you exactly where EVE and real humans diverge, which is
where to tune the model next.

## Via MCP

`eve_calibrate` loads a human-study file, runs a matching EVE population, and
returns the calibration report — so an agent can continuously validate EVE's
realism against ground truth. See [integrations.md](integrations.md).
