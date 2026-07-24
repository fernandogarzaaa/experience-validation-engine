# Product Intelligence (Phase 3)

UX findings tell you what's broken. **Product intelligence** tells you what the
product *is* and where it leaks — inferred purely from how a simulated
population behaved, with no access to the app's source (the human-perception
boundary holds).

```ts
import { simulatePopulation, inferProductIntelligence, renderProductIntelligenceMarkdown } from "experience-validation-engine";

const study = await simulatePopulation({ url: "mock:", size: 30, seed: 7 });
const intel = inferProductIntelligence(study);
console.log(renderProductIntelligenceMarkdown(intel));
```

## What it infers (`ProductIntelligence`)

| Field | How it's derived |
|---|---|
| `personas` | The behavioural segments the population splits into, with each cohort's real success rate and its most typical base persona |
| `businessGoals` | Screens classified by keyword into goals (acquisition, monetization, engagement, retention, …), ranked by **traffic share** |
| `criticalWorkflows` | The dominant path reconstructed from observed screen→screen transitions, plus the single most-traveled transition |
| `featureImportance` | Every screen scored by reach × engagement, flagged if it sits on the critical path |
| `highFrictionPages` | Screens with heavy revisiting or abandonment, each with the reason |
| `dropoffCauses` | Where abandonment concentrates, with the most likely cause drawn from the findings on that screen |

Everything is deterministic: the same study always yields the same product
report.

## From the CLI

```bash
eve study mock: --size 30 --seed 7 --product
eve study mock: --size 30 --seed 7 --product --panel --out .eve-output/study
```

## Via MCP

The tool `eve_product_report` runs the population and infers the product
intelligence in one call — so an AI coding agent can ask "what is this product
for, and where does it leak?" See [integrations.md](integrations.md).

## Relationship to findings

This sits on top of [population studies](population.md): the study answers "how
do users fare?", the [moderated study](moderated-study.md) answers "should we
ship?", and product intelligence answers "what does the product do, and what
should we build?".
