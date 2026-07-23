---
name: eve
description: >-
  Validate the human experience of a web app with the Experience Validation
  Engine (EVE). Use when the user asks to "validate the UX/experience", "run
  EVE", "simulate a user", "UX-test" a site, check how a persona (first-time
  user, elderly user, impatient user, …) would fare, or wants an experience
  score for a running web app. Drives the EVE MCP tools (eve_run_session,
  eve_list_personas, eve_benchmark, …). Not for functional/unit testing.
---

# EVE — Experience Validation (via MCP tools)

EVE simulates a realistic human — a persona with reading speed, working
memory, emotions and patience — using a web app through a browser, then
returns an evidence-backed experience report (an overall 0–100 score,
severity-ranked findings, the outcome, and a first-person journal explaining
*why* the user reacted as they did). This plugin exposes EVE as MCP tools;
prefer them over shelling out.

## Tools

- **`eve_run_session`** — the main tool. Simulate one session.
  - `url`: a real `https://…` URL (needs a browser backend), or **`mock:`**
    for the built-in offline demo app (no browser, always works — use it to
    show the user what a report looks like).
  - `persona` (default `first-time-user`), optional `goal`,
    `goal_success_signals`, `profession`, `culture`.
  - `seed`: **always set this** so runs are reproducible/comparable.
  - `cognitive: true` adds selective attention, cognitive load, trust and the
    expectation engine; `utility: true` uses utility-based decisions.
  - `remember_file`: persist memory across runs — call repeatedly against the
    same app to watch the operator learn (get faster).
  - Writes the full report to `output_dir` (default `.eve-output`).
- **`eve_run_usability_study`** — simulate a whole **population** of varied
  operators against the app and get aggregate stats (success/drop-off rates,
  distributions, a task-completion histogram, a navigation heatmap, expected
  user segments, and the findings most people hit). Use this instead of a
  single session when the user wants "how will *users* fare?" rather than "how
  did this one persona do?". Set `output_dir` to also write a research dataset
  (JSON/CSV/Markdown).
- **`eve_list_personas`** / **`eve_list_professions`** / **`eve_list_cultures`**
  — the catalogs. Check these before guessing names.
- **`eve_benchmark`** — validate EVE itself against known-good/bad apps
  (offline; confirms the instrument is calibrated).
- **`eve_get_report`** — read the full markdown/JSON report back from
  `output_dir` when the run summary isn't enough detail.

## Recommended flow

1. If unsure which persona fits, call `eve_list_personas`. Sensible defaults:
   `first-time-user` (onboarding), `impatient-user` (performance/friction),
   `accessibility-user` + `elderly-user` (accessibility), `power-user`
   (expert efficiency).
2. Call `eve_run_session` with a `seed` and, when the user names a task, a
   `goal`. Enable `cognitive` + `utility` for a deeper simulation.
3. Summarize: lead with the overall score and outcome (`endReason`), then
   critical/major findings with their evidence, then one or two journal
   highlights. If findings need more depth, call `eve_get_report`.

An outcome of `abandoned` means the simulated user churned — treat it as a
critical result and explain where the experience broke.

## Prerequisites

The MCP server runs via `npx -y experience-validation-engine eve-mcp`. Real
URLs need a browser backend once (`npx playwright install chromium`); `mock:`
needs nothing.
