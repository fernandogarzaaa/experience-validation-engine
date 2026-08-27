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
- **`eve_run_user_study`** — the population study **plus an AI research panel**
  (UX Researcher, Interaction Designer, Accessibility Specialist, QA Engineer,
  Behavioral Psychologist, Product Manager) and a moderator that returns an
  executive report with a **ship verdict** (ship / ship-with-fixes /
  do-not-ship), consensus, conflicts, and prioritized fixes. Use this when the
  user wants a go/no-go decision with a rationale, not just numbers.
- **`eve_product_report`** — infer **product intelligence** from how the
  population behaved: user personas, business goals, critical workflows,
  feature importance, high-friction pages, and drop-off causes. Use when the
  user wants product insight ("what is this product for, where does it leak?"),
  not just UX findings.
- **`eve_compare_builds`** — study several **builds** (ordered oldest→newest)
  and report the experience **trend**: which metrics improved or regressed
  (success, drop-off, score, confidence, frustration, trust, effort). Use to
  catch a UX regression between builds even when functional tests pass.
- **`eve_application_map`** — given only a URL, autonomously explore and return
  an **application map**: screens and their purpose, the navigation graph (as a
  Mermaid diagram), information architecture, hubs, dead-ends, and unexercised
  affordances. Use to understand an unfamiliar app's structure and coverage.
- **`eve_predict_ux`** — predict the wider user base's experience with
  **confidence intervals**: abandonment, confusion, onboarding-failure, and
  accessibility-barrier rates, a modeled support-contact rate, and predicted
  struggle screens. Use to forecast where users will struggle before shipping.
- **`eve_twin_session`** — run a session as a persistent, evolving **digital
  twin** (a named user model that remembers apps, grows more expert, and shifts
  confidence across sessions). Created on first use; call repeatedly with the
  same `twin_file`/`twin_id` to evolve it. Use to model a specific recurring
  user over time.
- **`eve_calibrate`** — score EVE's **realism** against a file of anonymized
  human usability traces: a 0–100 similarity score plus behavior/navigation/
  timing similarity and frustration/confidence alignment. Use to validate (and
  improve) how human-like EVE is for a given app.
- **`eve_read_artifact`** — read what software *produced* rather than driving
  what it does: a report, a slide deck, an analytics or CSV export, a `--help`
  screen, a terminal transcript or CI log, an API payload, a README. Returns
  what the reader understood (0–100) and what got in the way — terms used
  before they were defined, figures with no caption, numbers with no baseline,
  slides too dense to read at slide pace, an ending that never says what to do.
  - `target`: a file path, an `https://…` URL, or `-` for standard input.
  - `persona` (default `first-time-user`) genuinely changes the result: a
    specialist keeps a dense passage a first-time reader loses.
  - `genre` / `format` override detection when you know better than the file
    extension does; `seed` for reproducibility.
  - Use this when the question is "would someone understand this?", not "can
    someone use this?" — and reach for it on docs, decks and reports the way
    you reach for `eve_run_session` on an app.
- **`eve_evaluate_conversation`** — talk to something that **answers back**: a
  support bot, an LLM copilot, a voice assistant, an in-product "ask me
  anything". Returns what it understood (0–100) and what it missed — replies
  that answered a different question *without saying so*, how many times the
  person had to rephrase, whether it ever admitted being lost, whether there
  was any route to a human, how long they waited.
  - `target`: a chat endpoint URL, or `mock:` for the offline demo bot.
  - `goal`: what the person came for — it becomes their opening line, so
    phrase it as they would say it ("get a refund for being charged twice").
  - `reply_path` / `headers` / `body_template` for endpoints that do not match
    a common shape; `seed` for reproducibility.
  - The operator rephrases and gives up like a real person, so `abandoned`
    means they walked away — treat it as critical.
  - Use when the question is "would this understand someone?", not "can
    someone use this?"
- **`eve_multimodal_scan`** — perceive **visual cues** (icons, charts, media,
  loading states, toasts, text-in-images, motion) across an app and flag
  unlabeled visuals that are ambiguous to humans / invisible to screen readers.
- **`eve_bench`** — run **EVE Bench**, a multi-dimensional scorecard for the
  instrument itself (task success, overall, frustration, trust, cognitive load,
  expectation alignment, learnability) over reference apps, with a
  construct-validity check. Use to publish or gate on EVE's own calibration.
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
critical result and explain where the experience broke. On a reading session
(`eve_read_artifact`) it means the reader put the artifact down unfinished,
which is the same signal for a document that churn is for an app.

## Prerequisites

The MCP server runs via `npx -y experience-validation-engine eve-mcp`. Real
URLs need a browser backend once (`npx playwright install chromium`); `mock:`
needs nothing.
