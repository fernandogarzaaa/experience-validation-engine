---
name: eve
description: >-
  Run the Experience Validation Engine (EVE) — a cognitive simulation that
  experiences software like a human — against a URL or the built-in mock app,
  then interpret its experience report. Use when the user asks to "validate
  the experience", "run EVE", "simulate a user", "UX-test" a site or app,
  check how a persona (first-time user, elderly user, impatient user, etc.)
  would fare, or wants an experience/usability score for a running web app.
  Not for functional/unit testing or scraping.
---

# EVE — Experience Validation

EVE simulates a realistic human (persona with reading speed, memory,
emotions, patience) using a web app through the browser, then produces an
evidence-backed experience report. It is installed in this repository.

## Prerequisites

- `npm install` has been run in the repo root.
- For real URLs: `npx playwright install chromium` (once). The `mock:` URL
  needs no browser and is the right smoke test.

## Running a session

```bash
# Offline demo (always works):
npx tsx src/cli/main.ts run mock: --persona curious-explorer --steps 25 --quiet
# If dist/ is built, `node bin/eve.js run ...` is equivalent.

# Real app:
npx tsx src/cli/main.ts run <URL> \
  --persona <persona> \
  --goal "<what the user is trying to do>" \
  --seed 7 --quiet
```

Pick personas with `npx tsx src/cli/main.ts personas`. Sensible defaults:
`first-time-user` for onboarding questions, `impatient-user` for performance
concerns, `accessibility-user` + `elderly-user` for accessibility audits.

Always pass `--seed` so reruns are comparable. Add `--goal` whenever the
user names a task; include `goalSuccessSignals` via a YAML config when
success text is known (see `eve.config.example.yaml`).

## Reading the results

Outputs land in `.eve-output/`:

- `report.md` — read this one; it has the executive summary, scored
  dimensions with evidence, findings by severity, expectation violations,
  the emotional timeline and the session journal.
- `report.html` — hand to the user for the visual version.
- `report.json` — machine-readable, for scripting.

Exit codes: `0` fine, `1` critical findings (including the operator giving
up — treat that as a churned user), `2` config error.

When summarizing for the user: lead with the overall score and outcome
(`endReason`), then critical/major findings with their evidence, then the
one or two most telling journal moments (the first-person rationale lines
show *why* the simulated user struggled). Recommend the quick wins verbatim
from the report.

## Programmatic use (for deeper analysis)

```ts
import { EveSession, MockAdapter, DEMO_APP } from "./src/index.js";
const result = await new EveSession({
  adapter: new MockAdapter(DEMO_APP),
  startUrl: "mock:landing",
  persona: "first-time-user",
  seed: 1,
  paceScale: 0,
}).run();
```

`result.iterations[i].rationale` explains each decision; `result.findings`
and `result.scores[].evidence` carry the proof for every claim.
