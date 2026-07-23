# Experience Validation Engine (EVE)

> **AI that experiences software like a human.**

[![CI](https://github.com/fernandogarzaaa/experience-validation-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/fernandogarzaaa/experience-validation-engine/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

EVE is **not** another testing framework, browser-automation tool, or
Playwright wrapper. It is an **autonomous cognitive simulation engine**: a
simulated human — with reading speed, motor precision, memory, emotions,
expectations and a breaking point — sits down in front of your software and
uses it. Then EVE tells you what that experience was like, with evidence.

**Code correctness ≠ good software.** A green test suite proves your
implementation matches your intent. It says nothing about whether a
first-time user can sign up, whether an impatient user survives your loading
states, or whether your error page strands people. Users experience
interfaces, not implementations — EVE validates the experience.

```
$ eve run https://staging.example.com --persona first-time-user --goal "sign up"

  #0 read the screen — New screen — let me look around and figure out what this is.
  #1 click "Get started" — "Get started" matches what I'm trying to do (sign up).
  #2 type "alex@example.com" into "Email address" — This form wants "Email address" — filling it in.
  (made and corrected 1 typo(s))
  #3 click "Create account" — The form is filled in — "Create account" should submit it.
  ...
  ────────────────────────────────────────────────
  Overall experience score : 72/100
  Findings                 : 0 critical, 2 major, 5 other
  Outcome                  : goal-achieved
  Reports                  : .eve-output/report.html
```

## How it works

Every simulated operator runs the **human loop** — never a script:

```
Observe → Interpret → Update Mental Model → Predict → Decide → Interact
   ↑                                                              │
   └── Adjust Internal State ← Compare Prediction vs Reality ← Observe Again
```

Three principles make it a simulation rather than automation:

1. **No privileged information.** The operator perceives only what a human
   perceives: pixels, visible text, the cursor, the URL bar, loading
   indicators. It cannot read your source, your DOM internals, your network
   tab or your logs. This boundary is structural — everything downstream of
   the perception layer literally has no channel to anything else.
2. **A continuously evolving cognitive state.** Goals and subgoals, a mental
   model with predictions, working/episodic/semantic/spatial memory with
   real forgetting, and nine emotions (confidence, frustration, trust,
   confusion, curiosity, fatigue, satisfaction, interest, stress) updated by
   appraisal after every action. Frustration past the persona's tolerance =
   the operator gives up, exactly like your users do.
3. **Prediction as the engine of evaluation.** Before acting, the operator
   predicts the outcome; afterwards, prediction meets reality. The gap
   drives emotion, learning, findings ("expectation violations") and scores.

## What you get

- **17 built-in personas** — first-time user, power user, elderly user,
  keyboard-only accessibility user, color-blind user, impatient user,
  anxious user, curious explorer… each a coherent bundle of 16 behavioral
  traits (reading speed, click accuracy, patience, risk tolerance, memory,
  keyboard preference…) plus custom personas in code or YAML.
- **Autonomous workflow discovery** — login, signup, password reset,
  dashboards, CRUD, settings, search, checkout, wizards… recognized from
  perception alone and mapped into a completion-tracked graph.
- **Visual observation** — WCAG contrast (with color-blindness simulation),
  clipped/overflowing/overlapping/misaligned layout detection, tiny
  text/targets, blank screens, pixel-diff visual-regression on revisits.
- **Evidence-backed scoring** — 16 dimensions (usability, learnability,
  accessibility, efficiency, navigation, workflow quality, error recovery,
  responsiveness, cognitive load, trust…) where every number traces to
  something that happened.
- **Rich reports** — self-contained HTML (emotion timeline, interaction
  heatmap, screenshots, session journal with first-person rationale),
  Markdown and JSON. Exit codes make `eve run` a CI gate.
- **Pluggable everything** — browser adapters (Playwright, Puppeteer,
  Selenium, offline mock), decision policies (offline heuristic mind or an
  optional Anthropic-powered one), and passive plugins (accessibility,
  performance, LLM design critic, your own).

## Quick start

```bash
npm install experience-validation-engine

# 30-second offline demo (no browser needed):
npx eve run mock: --persona curious-explorer --steps 25
open .eve-output/report.html

# Real site:
npm install playwright && npx playwright install chromium
npx eve run https://staging.your-app.example.com \
  --persona impatient-user --goal "figure out what this product does"
```

Programmatic:

```ts
import { EveSession, PlaywrightAdapter, writeReports } from "experience-validation-engine";

const result = await new EveSession({
  adapter: new PlaywrightAdapter(),
  startUrl: "https://staging.example.com",
  persona: "first-time-user",
  goal: "sign up for an account",
  goalSuccessSignals: ["welcome"],
  seed: 42,                      // same seed → same session
}).run();

await writeReports(result, ".eve-output");
```

Sessions are **deterministic**: (app state, persona, seed) fully determine
the run — so a changed path after a deploy is a real behavioral change in
your product, and different seeds sample different plausible humans.

## Beyond one operator (Phase 2)

EVE is also a research platform for autonomous human-experience simulation.
Opt-in systems (all backwards-compatible — default behavior is unchanged):

- **A deeper mind** — selective **attention** (fixations, change/inattentional
  blindness), **utility-based decisions** whose weights are driven by emotion,
  a full **expectation engine** (predict outcome/destination/latency/feedback,
  then score the surprise), a **Cognitive Load Index**, and a **trust model**
  that builds slowly and breaks fast. Turn it on with `cognitive: true`.
- **Long-term memory** — the operator remembers an app between sessions and
  gets measurably more efficient (e.g. 7 → 5 → 5 steps), with **Learning
  Rate**, **Retention**, **Recognition-vs-Recall** and a **forgetting curve**.
- **Social & cultural personas** — professional overlays (doctor, lawyer,
  accountant…) and locale profiles (reading direction, date/currency, privacy).
- **Behavioral regression** — catch UX regressions that keep functional tests
  green: the app still works, but now takes more clicks, hesitation, or trust.
- **Experience forecasting** — predict where future users will struggle and
  which changes lift completion most.
- **An AI panel** — an independent **design critic**, a **moderator** that
  finds cross-persona consensus, a **product manager** that writes a
  prioritized backlog, and a **developer** that emits GitHub/Linear/Jira
  tickets.
- **Collaborative sessions** — multi-operator handoffs and approval chains.
- **A benchmark suite** — known-quality apps EVE must rank correctly
  (`eve benchmark`), its standing construct-validity check.

```bash
eve run mock: --persona first-time-user --cognitive --utility --panel
eve run mock: --remember .eve-memory.json --seed 1   # run repeatedly → watch it learn
eve benchmark                                         # validate the instrument
```

## Use it inside your AI assistant

EVE ships an **MCP server** (`eve-mcp`), so any Model Context Protocol client —
Claude Desktop, Claude Code, OpenAI Codex, Cursor, Windsurf, VS Code Copilot —
can drive it directly. Your assistant gains tools like `eve_run_session`,
`eve_list_personas`, and `eve_benchmark`, then *"run an EVE session against
`mock:` as a first-time user"* just works (offline, no browser).

```bash
# Claude Code — one line:
claude mcp add eve -- npx -y experience-validation-engine eve-mcp

# Claude Code — or install as a plugin (bundles the /eve skill):
#   /plugin marketplace add fernandogarzaaa/experience-validation-engine
#   /plugin install eve
```

For every other client, drop this into its MCP config:

```json
{ "mcpServers": { "eve": {
  "command": "npx", "args": ["-y", "experience-validation-engine", "eve-mcp"]
} } }
```

See the [Integration Guide](docs/integrations.md) for per-platform config
(Claude Desktop, Codex, Cursor, Windsurf, VS Code) and the full tool reference.

## Documentation

| | |
|---|---|
| [Integration Guide](docs/integrations.md) | Use EVE as an MCP server / plugin in Claude, Codex, Cursor, … |
| [Population Simulation (Phase 3)](docs/population.md) | Run hundreds of operators → a statistical usability study + research dataset |
| [Architecture](docs/architecture.md) | The human loop, the retina abstraction, module map |
| [Cognitive Model (Phase 2)](docs/cognitive-model.md) | Attention, utility, expectation, load, trust, learning |
| [Analysis Systems (Phase 2)](docs/panel-and-analysis.md) | Regression, forecasting, the AI panel, benchmarks, collaboration |
| [Research Foundations](docs/research.md) | The HCI / cognitive-science grounding for every subsystem |
| [Developer Guide](docs/developer-guide.md) | Install, CLI, API, CI integration, events |
| [Persona Guide](docs/persona-guide.md) | The trait model; designing personas |
| [Plugin Guide](docs/plugin-guide.md) | Writing judgment plugins |
| [Configuration](docs/configuration.md) | YAML reference and semantics |
| [API Reference](docs/api-reference.md) | Public surface |
| [Examples](docs/examples.md) | Runnable examples and CI recipes |
| [Roadmap](ROADMAP.md) | Where this is going |
| [Contributing](CONTRIBUTING.md) | How to help |

Agent skills: EVE ships ready-to-use skills for
[Claude Code](.claude/skills/eve/SKILL.md) and
[Codex](.codex/skills/eve/SKILL.md), so coding agents can run experience
validation on the software they build.

## Project layout

```
src/
├── engine/      the human loop (EveSession)
├── browser/     adapters + perception script + humanizer
├── cognition/   mental model, salience, decision policies
├── personas/    trait model + built-in library
├── emotion/     appraisal-driven 9-emotion state
├── memory/      working/episodic/semantic/spatial + forgetting
├── planning/    goal stack + exploration strategies
├── observation/ percept construction, perceived latency
├── vision/      pixel + geometry analysis, color-vision simulation
├── workflow/    discovery catalog, detector, graph
├── scoring/     evidence-backed 16-dimension scores
├── plugins/     accessibility, performance, LLM critic + your own
├── reporting/   HTML / Markdown / JSON renderers
├── config/      YAML config
├── cli/         the `eve` command
└── mcp/         the `eve-mcp` Model Context Protocol server
```

## License

[MIT](LICENSE) © Fernando Garza and contributors.
