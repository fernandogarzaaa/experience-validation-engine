# Getting started with EVE

EVE (Experience Validation Engine) evaluates software the way a human
operator would: it runs a simulated person through your product and reports
what they experienced, where they got confused, and where they gave up.

## Install

```bash
npm install experience-validation-engine
```

Or run it without installing:

```bash
npx eve --help
```

## Your first run (30 seconds, no browser needed)

```bash
npx eve run mock: --persona curious-explorer --steps 25
open .eve-output/report.html
```

This runs a simulated operator against a mock target and writes an HTML
report with the operator's journey, findings, and scores. Nothing leaves
your machine.

## Test a real site

EVE ships with its own browser; this fetches Chromium on first use:

```bash
npx playwright install chromium
npx eve run https://staging.your-app.example.com \
  --persona impatient-user --goal "figure out what this product does"
```

Pick a persona that matches the user you care about. A few from the
bundled library: `first-time-user`, `power-user`, `accessibility-user`,
`elderly-user`, `impatient-user`, `distracted-user`, `developer-as-customer`.

## Read what your software produces

`eve read` points an operator at a document instead of a UI:

```bash
npx eve read ./docs/getting-started.md --persona first-time-user
npx eve read ./deck.md --genre presentation
npx eve read ./metrics.csv --goal "did signups grow"
git log --oneline | npx eve read - --genre transcript
```

## Talk to something that answers back

```bash
npx eve chat mock: --goal "get a refund for being charged twice"
npx eve chat https://api.example.com/chat --goal "reset my password"
```

## How to read a report

Every run returns three things:

- **Outcome** — what the operator concluded, in words.
- **Findings** — expectation violations: moments where the operator
  predicted one thing and the product did another. These are the bugs
  your analytics cannot see.
- **Scores** — task success, efficiency, and emotional trajectory
  (confidence, frustration, trust, confusion) across the session.

An operator that gives up is a finding, not a failure: frustration past
the persona's tolerance ends the session exactly the way a real user
would abandon your product.

## What is actually happening

Each operator runs the human loop, never a script:

```
Observe -> Interpret -> Update Mental Model -> Predict -> Decide -> Interact
```

The operator perceives only what a human perceives (pixels, visible text,
the cursor, the URL bar, loading indicators). It cannot read your source,
your DOM internals, your network tab, or your logs. Before acting it
predicts the outcome; the gap between prediction and reality drives
emotion, learning, and findings.

## Next steps

- `docs/persona-guide.md` — choose and tune personas.
- `docs/configuration.md` — budgets, step limits, and run options.
- `docs/api-reference.md` — the programmatic interface.
- `docs/examples.md` — more worked examples.
- `docs/mcp-adapter.md` — drive EVE from Claude Code, Codex, or Cursor.
