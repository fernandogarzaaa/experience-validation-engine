# Analysis Systems (Phase 2)

Beyond simulating one operator, EVE Phase 2 adds systems that analyze
experience across sessions, builds and personas, and a team of AIs that turn
raw findings into product decisions.

## Experience & behavioral regression (`regression/`)

Functional tests answer *"does it still work?"*. EVE answers *"is it still a
good experience?"*. `compareExperience(baseline, candidate)` compares two
sessions (same persona, seed and goal, different build) across cognitive and
behavioral metrics — completion, steps, duration, backtracks, dead clicks,
errors, surprise rate, confidence, frustration, trust, cognitive load,
hesitation — and reports **regressions the functional suite cannot see**: the
app still completes the task, but now with more clicks, an error, or lower
confidence.

```ts
import { compareExperience } from "experience-validation-engine";
const report = compareExperience(baselineRun, candidateRun);
// report.verdict: "improved" | "unchanged" | "regressed"
// report.regressions: [{ metric, baseline, candidate, delta, severity }, ...]
```

See `examples/behavioral-regression.ts` for a build that stays functionally
green while regressing the experience.

## Experience forecasting (`forecasting/`)

`forecastExperience(sessions)` extrapolates from observed runs to predict
where **future** users will struggle: high-friction screens (weighted by how
many personas hit them), workflows at risk of abandonment, confidence-draining
screens, and the highest-leverage changes with estimated completion lift.

## User-journey discovery (`workflow/journeys.ts`)

`discoverJourney` reconstructs the sequence the operator actually performed
toward a goal — no predefined script — annotated with friction points
(errors, dead clicks, backtracks, latency) and whether a terminal state was
reached. Every `SessionResult` includes a `journey`. This is task analysis
recovered from behavior (GOMS; Card, Moran & Newell 1983).

## The AI panel (`panel/`)

After a panel of personas runs, `runPanel(sessions)` executes a team of AIs:

| Role | What it does |
|---|---|
| **Design Critic** | Independent expert heuristic inspection (Nielsen's 10 heuristics + typography/layout/microcopy/forms/navigation/onboarding), separate from the behavioral simulation. Returns an inspection score and categorized issues. |
| **Forecaster** | The experience forecast above. |
| **Moderator** | Synthesizes all sessions: finds **consensus** issues (multiple personas independently hit them — the highest-confidence signal), surfaces **disagreements**, and writes one executive report with top priorities. |
| **Product Manager** | Turns consensus + forecast + critique into a prioritized backlog of **epics and user stories** with RICE-style priority scores, business impact and estimated completion lift, plus a phased roadmap. |
| **Developer** | Translates the backlog into **GitHub / Linear / Jira / Markdown** tickets with acceptance criteria — data + serializers, ready to pipe into a tracker. |

```ts
import { runPanel, renderPanelMarkdown, toGitHubIssues } from "experience-validation-engine";
const panel = runPanel(sessions);
console.log(panel.executive.executiveSummary);
await writeFile("panel.md", renderPanelMarkdown(panel));
const issues = toGitHubIssues(panel.tickets); // → create via the GitHub API
```

The Design Critic is deterministic and offline (heuristic inspection); the
optional `LlmCriticPlugin` adds an LLM design pass *during* the session if you
want model-based critique too. Combining behavioral testing with independent
expert inspection is the classic dual-method evaluation strategy — each finds
problems the other misses (the evaluator effect; Hertzum & Jacobsen 2001).

CLI: add `--panel` to any `eve run`, or run `examples/ai-panel.ts`.

## Collaborative sessions (`collaborative/`)

`runCollaborative(scenario)` runs a sequence of operators against the same app
— modeling **handoffs, approval chains and shared workflows**. Roles
optionally share long-term memory (institutional knowledge transfer), and each
begins where the previous ended. The result records every handoff and detects
**chain breakdowns**: a role handing incomplete work downstream — a
shared-workflow failure that testing each screen in isolation would miss.

## Benchmark suite (`benchmarks/`)

Three apps implement the *same* task at deliberately different quality levels
(excellent / average / bad). `validateBenchmarks()` runs a persona panel
against all three and asserts EVE scores them in strict order — EVE's standing
**construct-validity** check. If a change to the cognitive model breaks the
ordering, the instrument has lost discriminative power (enforced by a test and
`eve benchmark`, which exits non-zero on failure).

```
$ eve benchmark
  excellent  mean score 83/100
  average    mean score 73/100
  bad        mean score 63/100
  EVE correctly ranked the benchmarks — the instrument discriminates UX quality.
```
