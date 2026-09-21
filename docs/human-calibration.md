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
| `timingSimilarity` | Duration similarity over OBSERVED durations on both sides — `null` unless both sides report `durationMs`. Never falls back to steps |
| `stepSimilarity` | How closely step counts match (efficiency — explicitly NOT timing) |
| `trajectorySimilarity` | Aligned trajectory comparison (action agreement, dwell distributions, hazard) — currently `null`: requires per-step human action logs; the transition-distribution cosine above is edge-overlap, not trajectory validation |
| `frictionCorrelation` | Pearson correlation of **where** friction/abandonment concentrates, per screen (−1..1) |
| `frustrationAlignment` / `confidenceAlignment` | Closeness of aggregate self-reports (null if humans didn't report them) |

Metrics that can't be computed (e.g. no shared screens, or no self-reports) are
`null` and explained in `notes` — nothing is fabricated. **Lower dimensions are
the point**: they tell you exactly where EVE and real humans diverge, which is
where to tune the model next.

## The calibration dataset format (`calibration/record.ts`)

`buildCalibrationDataset(sessionResult)` exports every loop iteration as a
machine-readable `CalibrationRecord`: what EVE saw (URL, stable/sensitive
keys), believed (emotion), predicted, did, what happened (outcome incl.
`latencyEvidence`), per-section provenance (observed / derived / modeled /
heuristic), the generating parameters (seed, persona traits, policy) plus
versioned identifiers (`behaviorModelVersion`, `parameterSetVersion`,
`surfaceAdapter`), and `calibrationStatus: "uncalibrated"` with a null
`humanReference` slot. The human slot (`HumanIterationReference`) is
deliberately richer than current aggregates — timestamps, intended/actual
action, target, coordinates, durations, corrections, transitions,
abandonment, self-reports, and recovery behavior (`retry`, `undo`,
`backtrack`, `seek-help`, `strategy-change`, `takeover`, …) — all optional,
so future intervention data fits without a schema migration.
`renderCalibrationRecordsJsonl()` writes the append-friendly dataset format.
Pair each record with a human-observed step and the trajectory/action/dwell
comparisons become computable — this record is the schema the future
calibration engine will be built on, not a side export.

## Calibration maturity (terminology)

Do not call parameters "calibrated" on small convenience samples:

```text
<30 traces              exploratory (tune freely, claim nothing)
~30 traces              pilot calibration (methodology check, not validity)
larger dataset
  + held-out evaluation  calibrated parameter candidate
replicated
  held-out validation    validated parameter
```

The required N depends on parameter count, populations, surfaces, task
diversity, modality, variance, and desired confidence — the methodology
determines the data, not the other way around. Splits must hold out whole
tasks/applications/users/interfaces, never just fit and re-score the same
traces.

## Model freeze

Behavioral calibration runs against a frozen model: `BEHAVIOR_MODEL_VERSION`
(`src/core/versions.ts`, currently `1.0.0`) bumps on any architectural or
behavioral change, `PARAMETER_SET_VERSION` on any default-value change, and
any bump restarts calibration from `uncalibrated`. Every
`CalibrationRecord` carries both versions plus the surface adapter, so a
past prediction is reproducible and auditable.

## Via MCP

`eve_calibrate` loads a human-study file, runs a matching EVE population, and
returns the calibration report — so an agent can continuously validate EVE's
realism against ground truth. See [integrations.md](integrations.md).
