# Changelog

## Unreleased

### Phase 3 — Product intelligence

Product insight, not just UX findings — inferred purely from population
behaviour (no app source inspected).

- **`inferProductIntelligence(study)`** (`src/product/`) — reconstructs the
  **personas** the population reveals (with real per-cohort success rates), the
  **business goals** its traffic serves (keyword-classified, ranked by traffic
  share), the **critical workflows** (dominant path from observed transitions),
  **feature importance** (reach × engagement, critical-path flagged),
  **high-friction pages**, and **drop-off causes**. Deterministic;
  `renderProductIntelligenceMarkdown` renders it.
- **MCP tool `eve_product_report`** (9 tools total).
- **CLI `eve study --product`**.
- 8 tests (`tests/product.test.ts`), `examples/product-intelligence.ts`,
  `docs/product-intelligence.md`.

### Phase 3 — AI-moderated user study

Turns a population study's numbers into a decision.

- **`moderateStudy(study)`** (`src/study/`) — convenes six specialist
  "researcher" agents (UX Researcher, Interaction Designer, Accessibility
  Specialist, QA Engineer, Behavioral Psychologist, Product Manager). Each files
  an independent report — observations grounded in concrete study statistics,
  prioritized recommendations, a confidence, and a release stance. A moderator
  synthesizes them into an `ExecutiveStudyReport`: a **verdict**
  (ship / ship-with-fixes / do-not-ship), the panel's **consensus** and
  **conflicts**, a merged **priority** list, and an overall confidence.
  Deterministic; `renderModeratedStudyMarkdown` renders it.
- **MCP tool `eve_run_user_study`** — population + panel in one call (8 tools).
- **CLI `eve study --panel`** — appends the executive report to a study.
- 8 new tests (`tests/study.test.ts`), `examples/moderated-study.ts`,
  `docs/moderated-study.md`.

### Phase 3 — Population simulation & Research Mode

The first Phase 3 system: EVE now runs **populations**, not just individuals —
the "usability study" primitive of an autonomous UX research platform.

- **`simulatePopulation(options)`** (`src/population/`) — runs many varied
  operators (sampled across the persona library, optionally mixed with
  professions and cultures) against one app and aggregates them into a
  `PopulationStudy`: success/drop-off rates, overall-score and
  confidence/frustration/trust **distributions**, a task-completion
  **histogram**, a navigation **heatmap** (visits, reach, drop-off screens),
  the expected **user segments**, and findings ranked by population
  **prevalence**. Bounded-concurrency, and as reproducible as its seed.
- **Research Mode** (`src/research/`) — export any study to reproducible
  artifacts: `renderStudy`/`writeStudyDataset` produce a JSON snapshot, an
  operator-level **CSV** (pandas/R-ready), and a Markdown report.
- **MCP tool `eve_run_usability_study`** — the population study exposed to any
  MCP client (7 tools total now).
- **CLI `eve study`** — `eve study <url> --size 50 --seed 7 --out dir`, with a
  CI-friendly exit code (non-zero if <50% of the population succeeds).
- **Construct validity** — a population out-scores a bad app vs. an excellent
  one, the standing validity check (EVE Bench). 14 new tests
  (`tests/population.test.ts`), plus `examples/population-study.ts` and
  `docs/population.md`.

### MCP server & AI-platform plugin

EVE is now usable **inside any AI assistant** that speaks the Model Context
Protocol (Claude Desktop, Claude Code, OpenAI Codex, Cursor, Windsurf, VS Code
Copilot, …), with no change to the existing library or CLI.

- **`eve-mcp` server** (`src/mcp/`, new `eve-mcp` bin) — a stdio MCP server
  exposing six tools: `eve_run_session`, `eve_list_personas`,
  `eve_list_professions`, `eve_list_cultures`, `eve_benchmark`, and
  `eve_get_report`. It calls the engine in-process (no stdout pollution) and
  returns markdown or JSON. Importable via `experience-validation-engine/mcp`.
- **Claude Code plugin** — `.claude-plugin/plugin.json` +
  `marketplace.json` (install via `/plugin marketplace add` + `/plugin
  install eve`), bundling the MCP server and an MCP-oriented `eve` skill.
- **Drop-in configs** — a committed `.mcp.json` plus
  [docs/integrations.md](docs/integrations.md) with copy-paste setup for every
  major client.
- 10 new offline tests (`tests/mcp.test.ts`); dependencies
  `@modelcontextprotocol/sdk` and `zod` added.

## 0.2.0 — The cognitive model

Evolves EVE from a persona-driven heuristic agent into a research platform for
autonomous human-experience simulation. **Fully backwards compatible** — all
new systems are opt-in and the phase-1 behavior (and its 59 tests) is
unchanged. 97 tests total.

Deeper cognition (opt-in via `cognitive: true` / `UtilityCognition`):
- **Selective attention** — SEEV-based fixation allocation, F-pattern
  scanning (RTL-aware), inattentional & change blindness, saccade/fixation
  timing; only attended elements enter decisions.
- **Utility-based decisions** — expected-utility evaluation with softmax
  choice, weights modulated by emotion (frustration, confidence, trust,
  fatigue), loss-averse risk, Fitts-law motor effort.
- **Expectation engine** — multi-dimensional predictions (outcome,
  destination, latency, visual change, feedback) with match/surprise/violation
  scoring and compounding violation streaks.
- **Cognitive Load Index** — NASA-TLX-style decomposition + decision fatigue.
- **Trust model** — asymmetric build/break across predictability, consistency,
  error recovery, feedback quality, security perception; owns the trust emotion.

Memory & learning:
- **Persistent long-term memory** (`FileMemoryStore` / `InMemoryStore`) — the
  operator remembers apps across sessions and becomes more efficient.
- **Learning metrics** — Learning Rate (power law of practice), Retention,
  Recognition-vs-Recall, forgetting curve, per-session learning-curve SVG.

Personas:
- **Professions** (8 overlays) and **cultural profiles** (7 locales, LTR/RTL).

Analysis & the AI panel:
- **Behavioral & temporal regression** — catch UX regressions functional tests
  miss.
- **Experience forecasting** — predicted struggle/abandonment/confidence
  drains and highest-leverage changes.
- **User-journey discovery** — reconstruct the operator's path with friction.
- **AI panel** — independent Design Critic (Nielsen heuristics), Moderator
  (cross-persona consensus + executive report), Product Manager (RICE-ranked
  backlog + roadmap), Developer (GitHub/Linear/Jira/Markdown tickets).
- **Collaborative sessions** — multi-operator handoffs and approval chains.
- **Benchmark suite** — known-quality apps + construct-validity harness
  (`eve benchmark`).
- **Localization plugin** — flags currency/date/RTL convention mismatches.

Tooling & docs:
- CLI: `--cognitive --utility --culture --profession --remember --panel`;
  `eve benchmark`, `eve professions`, `eve cultures`.
- New docs: research foundations, the cognitive model, the analysis systems;
  five new runnable examples.

## 0.1.0 — Initial release

The complete cognitive simulation core:

- The human loop engine (`EveSession`) — observe → interpret → update mental
  model → predict → decide → interact → compare → adjust, fully seeded and
  reproducible.
- 17 built-in personas over a 16-trait behavioral model with accessibility
  profiles (keyboard-only, color vision, motor difficulty) + custom personas.
- Cognitive stack: mental model with prediction/expectation comparison;
  salience-based attention; working/episodic/semantic/spatial memory with
  forgetting; appraisal-driven 9-emotion state; goal stack with semantic
  keyword expansion; three exploration strategies.
- Decision policies: offline `HeuristicCognition` (default) and optional
  Anthropic-powered `LlmCognition` with graceful fallback.
- Browser layer: Playwright, Puppeteer and Selenium adapters (optional
  peers), an in-memory `MockAdapter` with demo app, a shared perception
  script ("retina abstraction"), and a humanizer (click scatter, typos,
  hesitation).
- Vision: WCAG contrast (declared + pixel-sampled) with color-blindness
  simulation, clipping/overflow/overlap/misalignment detection, tiny
  text/targets, blank-screen and visual-regression detection.
- Workflow discovery: 20+ workflow signatures, perceptual detector,
  completion-tracked graph.
- Scoring: 16 evidence-backed dimensions.
- Reporting: self-contained HTML (emotion timeline SVG, interaction heatmap,
  screenshots, session journal), Markdown, JSON.
- Plugins: accessibility, performance, optional LLM critic; plugin SDK.
- YAML configuration, `eve` CLI with CI-friendly exit codes.
- Claude Code and Codex skills.
