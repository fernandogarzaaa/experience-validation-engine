---
name: eve
description: >-
  Run the Experience Validation Engine (EVE) — a cognitive simulation that
  experiences software like a human — against a URL or the built-in mock
  app, and interpret its experience report. Use for requests like "validate
  the UX", "simulate a first-time user", "how would an impatient user fare",
  or "give me an experience score" for a running web app. Not for
  functional/unit testing.
---

# EVE — Experience Validation (Codex skill)

EVE simulates a realistic human persona using a web app through a real
browser and produces an evidence-backed experience report (scores, findings,
emotional timeline, session journal).

## Commands

```bash
npm install                             # once
npx playwright install chromium         # once, for real URLs only

# Offline smoke test (no browser needed):
npx tsx src/cli/main.ts run mock: --persona curious-explorer --steps 25 --quiet

# Real application:
npx tsx src/cli/main.ts run <URL> --persona first-time-user \
  --goal "<task the user is attempting>" --seed 7 --quiet

# List available personas:
npx tsx src/cli/main.ts personas
```

Persona selection: `first-time-user` (onboarding), `impatient-user`
(performance/friction), `accessibility-user` and `elderly-user`
(accessibility), `power-user` (expert efficiency), `non-technical-user`
(clarity of language). Always set `--seed` for reproducible reruns.

## Outputs

`.eve-output/report.md` (read first: executive summary, scores with
evidence, findings by severity, session journal), `report.html` (visual,
for the user), `report.json` (machine-readable).

Exit codes: `0` OK · `1` critical findings — note that "the operator gave
up" is a critical finding meaning a simulated user churned · `2` config
error.

## Reporting back

1. Overall score and outcome (`endReason`).
2. Critical and major findings, each with its evidence line.
3. One or two journal moments (first-person rationale) that show *why* the
   simulated user struggled.
4. The report's Quick Wins, verbatim.

For custom scenarios (custom personas, success signals, plugins), copy
`eve.config.example.yaml`, edit, and run with
`npx tsx src/cli/main.ts run --config <file>`.
