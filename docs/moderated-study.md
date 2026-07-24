# AI-Moderated User Study (Phase 3)

A [population study](population.md) produces the numbers. An **AI-moderated
user study** turns those numbers into a *decision*.

`moderateStudy(study)` convenes a panel of six specialist "researcher" agents.
Each reads the same population study through one professional lens and files an
independent report; a moderator then reconciles them into one executive report.

```ts
import { simulatePopulation, moderateStudy, renderModeratedStudyMarkdown } from "experience-validation-engine";

const study = await simulatePopulation({ url: "mock:", size: 30, seed: 7 });
const report = moderateStudy(study);

console.log(report.verdict);   // "ship" | "ship-with-fixes" | "do-not-ship"
console.log(renderModeratedStudyMarkdown(report));
```

## The panel

| Specialist | Lens |
|---|---|
| **UX Researcher** | Task success, drop-off, the shape of the population, biggest-loss segments |
| **Interaction Designer** | Navigation efficiency, revisits, dead-ends, path length |
| **Accessibility Specialist** | Contrast/target-size findings; how at-risk personas fared |
| **QA Engineer** | Reproducible broken/silent interactions and error-recovery gaps |
| **Behavioral Psychologist** | The emotional arc — frustration, trust, confidence; frustration-driven churn |
| **Product Manager** | Where a fix buys the most completion (highest-leverage issue) |

Each specialist emits **observations** (every one grounded in a concrete
statistic from the study), **recommendations** with a priority, a **confidence**
(grows with sample size), and a release **stance** (`block` / `caution` /
`ship`) derived from the worst thing they saw.

## The moderator synthesis (`ExecutiveStudyReport`)

- **`verdict`** — `do-not-ship` if <50% succeed or any specialist blocks;
  `ship-with-fixes` if drop-off is high or any specialist cautions; else `ship`.
- **`consensus`** — themes independently raised by ≥2 specialists (abandonment,
  broken interactions, accessibility, navigation, frustration/trust, success).
- **`conflicts`** — where the panel's stances diverge (e.g. QA sees a
  release-blocker in its domain while others see none), with an explanation.
- **`priorities`** — every recommendation merged and de-duplicated, scored, and
  ranked; actions multiple specialists call for rise to the top.
- **`confidence`** — mean panel confidence, discounted when conflicts exist.

The synthesis is deterministic: the same study always yields the same report.

## From the CLI

```bash
eve study mock: --size 30 --seed 7 --panel
eve study mock: --size 30 --seed 7 --panel --out .eve-output/study   # also writes moderated-study.md
```

## Via MCP

The tool `eve_run_user_study` runs the population **and** the panel in one call
and returns the executive report — so an AI coding agent can ask "is this
shippable?" and get a verdict with a rationale. See [integrations.md](integrations.md).

## Relationship to the session panel

This operates on a **population** (statistical evidence across many users). The
existing [`runPanel`](panel-and-analysis.md) operates on individual
`SessionResult`s (design critic, forecast, PM backlog, dev tickets). They are
complementary: use `runPanel` for a deep read of a few sessions, and
`moderateStudy` for a population-level go/no-go decision.
