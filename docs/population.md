# Population Simulation (Phase 3)

A single EVE session answers *"how did this one person do?"* A **population
study** answers the question a UX researcher actually ships on: *"how does the
distribution of real humans do?"*

`simulatePopulation` runs many varied operators against the same app — each an
ordinary seeded [`EveSession`](developer-guide.md), so a study is as
reproducible as its seed — and aggregates them statistically.

## Quick start

```ts
import { simulatePopulation } from "experience-validation-engine";
import { renderStudyMarkdown, writeStudyDataset } from "experience-validation-engine";

const study = await simulatePopulation({
  url: "mock:",              // offline demo app; swap for a real URL
  size: 40,                  // forty simulated humans
  professions: ["accountant", "designer", "executive"],
  cultures: ["en-US", "de-DE", "ja-JP"],
  seed: 7,                   // reproducible
});

console.log(renderStudyMarkdown(study));
await writeStudyDataset(study, ".eve-output/study"); // study.json + operators.csv + study.md
```

With no `personas` list, operators are sampled round-robin across the **whole
persona library**, giving a diverse population. Add `professions` / `cultures`
to mix overlays across the cohort.

## What you get (`PopulationStudy`)

| Field | Meaning |
|---|---|
| `successRate` / `dropoffRate` | Fraction who completed / abandoned |
| `overallScore` | Distribution (mean, sd, min/median/max, p25/p75) of the 0–100 score |
| `confidence` / `frustration` / `trust` | End-state emotion distributions |
| `stepsToComplete` | Distribution of steps among operators who completed |
| `completionHistogram` | Task-completion histogram (binned steps) |
| `navigationHeatmap` | Per-screen visits, reach, and drop-off counts |
| `segments` | Expected user segments (see below) |
| `topFindings` | Findings ranked by severity and **population prevalence** |
| `operators` | The full per-operator table |

"Success" means reaching the `goal` when one is set; for open-ended runs it
means finishing without abandoning.

### Expected user segments

Operators are classified (deterministically, first-matching rule wins) into
interpretable cohorts a researcher can act on:

`early-abandoners`, `frustrated-quitters`, `confused-wanderers`, `explorers`,
`persistent-strugglers`, `confident-completers`, `steady-completers`.

Each segment reports its size, share, mean score, and mean steps.

## Options

| Option | Default | Notes |
|---|---|---|
| `url` | — | required; `mock:` for offline |
| `label` | `url` | human-facing target name shown in reports (set when an `adapterFactory` drives an app that isn't the literal `url`) |
| `size` | `25` | number of operators |
| `personas` | whole library | names to sample from (round-robin) |
| `professions` / `cultures` | none | overlays mixed round-robin |
| `goal` / `goalSuccessSignals` | none | the task every operator attempts |
| `seed` | `1` | base seed; operator *i* uses `"<seed>#<i>"` |
| `maxSteps` / `maxDurationMs` | `60` / `10min` | per-operator budgets |
| `cognitive` / `utility` | `false` | deeper cognition / utility decisions |
| `browser` | inferred | `mock` for `mock:` URLs, else `playwright` |
| `adapterFactory` | `createAdapter` | **required for real browsers** — return a fresh adapter per operator |
| `concurrency` | `4` | operators run in parallel |
| `onProgress` | — | `(done, total) => void` |

For real URLs, give an `adapterFactory` so each operator gets an isolated
browser: `adapterFactory: () => new PlaywrightAdapter({ headless: true })`.

## Research Mode (dataset export)

Every study exports to reproducible research artifacts:

```ts
import { renderStudy, writeStudyDataset } from "experience-validation-engine";

renderStudy(study, "json");     // full snapshot
renderStudy(study, "csv");      // one tidy row per operator (pandas/R-ready)
renderStudy(study, "markdown"); // human-readable report
await writeStudyDataset(study, "out/"); // writes all three
```

The CSV loads straight into analysis tools:

```python
import pandas as pd
df = pd.read_csv("out/operators.csv")
df.groupby("segment")["overall"].describe()
```

## Via MCP

The same capability is exposed as the `eve_run_usability_study` tool, so any
MCP client (Claude, Codex, Cursor, …) can run a study directly — see
[integrations.md](integrations.md). Set `output_dir` to also write the dataset.

## Construct validity

Population studies inherit EVE's benchmark discipline: a population on the
excellent reference app out-scores the same population on the bad one
(`tests/population.test.ts` → *"population construct validity"*). If that
ordering ever breaks, the instrument — not the app — is wrong.
