# Configuration Guide

EVE is configured via YAML (for the CLI) or `SessionOptions` (programmatic).
`eve.config.example.yaml` in the repository root is the annotated reference;
this page documents semantics.

## File format

```yaml
url: https://staging.your-app.example.com   # required
persona: first-time-user
goal: "sign up and create my first project"
goalSuccessSignals: ["project created"]
browser: playwright        # playwright | puppeteer | selenium | mobile | mock
device: iPhone 14          # only used when browser: mobile — see docs/mobile-web.md
headless: true
viewport: { width: 1280, height: 800 }   # ignored when browser: mobile (uses the device's own viewport)
maxSteps: 60
maxDurationMinutes: 10
explorationStrategy: curious   # curious | systematic | goal-directed
seed: 42
screenshots: true
paceScale: 0.15
outputDir: .eve-output
verbosity: normal          # quiet | normal | verbose
language: en
patience: 0.3              # optional shorthand: override persona patience
plugins:
  accessibility: true
  performance: true
  llmCritic: false         # or { model: ..., maxScreens: ... }
llmCognition: false        # or { model: ... }
customPersonas: []         # see persona guide
```

Run with `eve run --config file.yaml`; any CLI flag overrides the file.

## Key semantics

### `goal` and `goalSuccessSignals`

Without a goal the operator explores open-endedly and the session ends on
budget. With a goal, its words (expanded with conventional associations —
"password" also makes "log in" relevant) drive attention, and the session
ends successfully the moment every `goalSuccessSignals` string is visible on
screen. Choose signals a human would accept as proof ("invitation sent"),
not internal markers.

Because the check is substring presence in visible text, a signal is only as
good as its exclusivity to the finished state. Two failure modes are detected
and reported in `goalSignalWarnings` (and in `report.json`):

- **Already true at the start.** A signal satisfied by the opening screen —
  usually a word from the product's own name — cannot evidence that anything
  was accomplished. Such a signal set is ignored for the whole session and the
  goal is reported as not achieved.
- **Carried only by a control's label.** "export" satisfied solely by an
  `Export all` button means arriving at the button counts as exporting. This
  is a warning rather than a refusal, because a label is sometimes the only
  wording of a completed state — only you can tell the two apart.

Pick text that appears *after* the work is done, not text that offers it.

### `seed`

Any number or string. Same seed + same persona + same application state =
identical session. Change seeds to sample different plausible paths.

### `explorationStrategy`

- `curious` — novelty-weighted; best coverage of unfamiliar products.
- `systematic` — finishes each screen before moving on; best for audits.
- `goal-directed` — relevance-weighted; best when `goal` is set.

### `paceScale`

Multiplier from simulated human time to real browser pacing. `0.15` keeps
runs quick while preserving ordering; `1.0` runs at true human speed (useful
when watching `--headed`); `0` is as-fast-as-possible. Report timelines
always use full human time.

### `patience`

Convenience trait override — equivalent to cloning the chosen persona with a
different `traits.patience`. For anything more, define a custom persona.

### Budget interplay

A session ends at the first of: goal achieved, operator abandons (emotional
bailout or dead end), `maxSteps` iterations, `maxDurationMinutes` wall-clock.

### LLM options

`llmCognition` replaces the offline heuristic mind with an Anthropic-powered
one; `plugins.llmCritic` adds a per-screen design critique. Both need
`npm install @anthropic-ai/sdk` and an `ANTHROPIC_API_KEY` in the
environment, degrade gracefully when missing, and default to the
`claude-opus-4-8` model.

## Exit codes (`eve run`)

| Code | Meaning |
|---|---|
| 0 | Session completed, no critical findings |
| 1 | Critical findings (including abandonment) or session failure |
| 2 | Configuration/usage error |

This makes `eve run` directly usable as a CI gate.
