# Changelog

## Unreleased

### Quality — improvements surfaced by dogfooding

Fixes found by running EVE's own Phase-3 analysis on a model of EVE's (non-
e-commerce) console:

- **Broader classifiers** — the business-goal classifier (`src/product/`) and
  the app-map screen-purpose classifier (`src/appmap/`) now recognize
  tool/console vocabulary (reporting, tasks/runs, help/docs, configuration),
  not just web-commerce funnels. "Documentation" screens are no longer
  mislabeled as an editor.
- **Goal-less step reporting** — the Interaction Designer no longer flags a
  "too-long happy path" for open-ended studies, where step counts just reflect
  the step budget rather than path length; it reports exploration depth
  neutrally instead.
- **Report labels** — `simulatePopulation` accepts an optional `label` (and
  `PopulationStudy`, `ProductIntelligence`, and `UXPrediction` carry it), so
  reports show a meaningful target name instead of the literal `mock:` url when
  an `adapterFactory` supplies the app. `url` keeps its identity meaning and
  `label` is the display name; both default to the url, so existing behavior is
  unchanged.
- **Token normalization** — screen identifiers are normalized (camelCase split,
  separators to spaces) before keyword matching, so `newStudy` and
  `search-results` classify correctly and a hostname can no longer hijack a
  match.

7 new tests (`tests/dogfooding.test.ts`); 197 total.

## 0.3.0 — The autonomous UX research platform

Turns EVE from a cognitive-simulation engine into an **autonomous UX research
platform, consumable through MCP** — an AI coding agent can run a full usability
study before shipping. Ten Phase-3 systems (population simulation, AI-moderated
study, product intelligence, continuous UX regression, autonomous application
mapping, predictive UX, digital twins, human-validation calibration, multimodal
perception, and EVE Bench) land behind **16 MCP tools**, plus the `eve-mcp`
server and Claude plugin. Fully backwards compatible; 190 tests.

### Phase 3 — EVE Bench (benchmark platform)

Formalizes the benchmark into a multi-dimensional platform.

- **`runEveBench(options?)`** (`src/evebench/`) — runs a suite of known-quality
  reference apps (`EVEBENCH_CASES`) through the full cognitive simulation and
  publishes a per-case scorecard: task success, overall experience, frustration,
  trust, cognitive load, expectation alignment, and learnability (measured by
  step reduction on a second memory-backed run), rolled into a composite and an
  overall score, with a construct-validity check (excellent > average > bad).
  `renderEveBenchMarkdown` renders it; pass your own `cases` to benchmark a
  custom reference set.
- **MCP tool `eve_bench`** (16 tools total) — richer than `eve_benchmark`.
- 5 tests (`tests/evebench.test.ts`), `examples/eve-bench.ts` (with a CI gate),
  `docs/eve-bench.md`.

### Phase 3 — Multimodal perception

Perception beyond text, still inside the human boundary.

- **`analyzeMultimodal(session)` / `HeuristicMultimodalPerceptor`**
  (`src/multimodal/`) — recognizes higher-level visual constructs from the
  rendered `Percept`: icons, charts, media, loading states, toasts, text-in-
  images, and (with real screenshots) animation via frame diffs. Aggregates a
  `MultimodalReport` and surfaces perception risks — unlabeled icons/charts/
  images that are ambiguous to humans and invisible to screen readers. The
  `MultimodalPerceptor` interface is the extension point for OCR / vision-
  language backends; the default is deterministic. No source is inspected.
- **MCP tool `eve_multimodal_scan`** (15 tools total).
- 6 tests (`tests/multimodal.test.ts`), `examples/multimodal-perception.ts`,
  `docs/multimodal-perception.md`.

### Phase 3 — Human validation engine (calibration)

Measure EVE's realism against real humans instead of assuming it.

- **`calibrate(human, study)`** (`src/calibration/`) — imports anonymized human
  usability traces (`importHumanStudy` validates the JSON) and scores how
  closely EVE's population matches: a 0–100 similarity score plus behavior
  similarity (completion/abandonment), navigation similarity (cosine of
  transition vectors), timing similarity (effort), a per-screen friction-
  location Pearson correlation, and frustration/confidence alignment. Metrics
  that can't be computed are `null` with an explanatory note — nothing is
  fabricated. `renderCalibrationMarkdown` renders it.
- **MCP tool `eve_calibrate`** — loads a human-study file, runs a matching
  population, and reports realism (14 tools total).
- 8 tests (`tests/calibration.test.ts`), `examples/human-calibration.ts`,
  `docs/human-calibration.md`.

### Phase 3 — Human digital twins

Persistent, named user models that evolve across sessions.

- **`createTwin` / `runTwinSession` / `evolveTwin`** (`src/twins/`) — a twin
  ("Power User A", "Senior Accountant", …) couples a base persona (+ optional
  profession/culture) with an accumulating history: it remembers the apps it
  has used (reusing per-app memory, so it gets faster on familiar apps), grows
  more expert (power law of practice), and its confidence baseline drifts
  toward its lived performance. `runTwinSession` runs an ordinary EveSession as
  the evolved persona and folds the result back in. `renderTwinMarkdown`
  renders the profile.
- **Persistence**: `FileTwinStore` (JSON, many twins by id) and
  `InMemoryTwinStore`.
- **MCP tool `eve_twin_session`** — stateful: creates a twin on first use and
  evolves it across calls via `twin_file` (13 tools total).
- 8 tests (`tests/twins.test.ts`), `examples/digital-twin.ts`,
  `docs/digital-twins.md`.

### Phase 3 — Predictive UX

Forecast the wider user base's experience, with confidence intervals.

- **`predictUX(study)`** (`src/predict/`) — extrapolates from a population to
  predicted abandonment, confusion, onboarding-failure, and
  accessibility-barrier rates (each a proportion with a 95% **Wilson** interval,
  exported as `wilsonInterval`), a modeled support-contact rate per 100 users
  (explicit ±30% band), and the screens predicted to cause struggle. Each item
  declares its `basis` (observed vs modeled) so nothing overstates certainty.
  Deterministic; `renderUXPredictionMarkdown` renders it.
- **MCP tool `eve_predict_ux`** (12 tools total).
- 9 tests (`tests/predict.test.ts`), `examples/predictive-ux.ts`,
  `docs/predictive-ux.md`.

### Phase 3 — Autonomous exploration → application map

Given only a URL, reconstruct the whole app from perception.

- **`buildApplicationMap(sessions)`** (`src/appmap/`) — from one or more
  exploratory sessions, reconstructs the application map: screens with inferred
  purpose and visible affordances, the navigation graph (transitions with
  counts), entry points, hubs, dead-ends, an information architecture grouped by
  purpose, and the **unexercised affordances** (candidate hidden / edge paths).
  Perception only — no app source. `renderApplicationMapMarkdown` embeds a
  Mermaid nav-graph diagram; `renderApplicationMapMermaid` returns just the graph.
- **MCP tool `eve_application_map`** — explores with several operators and
  returns the map (11 tools total).
- 8 tests (`tests/appmap.test.ts`), `examples/application-map.ts`,
  `docs/application-map.md`.

### Phase 3 — Continuous UX regression

Track experience across a series of builds and catch regressions functional
tests miss.

- **`analyzeTrends(builds)`** (`src/trends/`) — given an ordered series of
  population studies (build 1 → N), turns each tracked metric (success rate,
  drop-off, overall score, confidence, frustration, trust, median steps) into a
  trend with its series, delta, least-squares slope, and a direction
  (`improved` / `regressed` / `stable`, direction-aware and epsilon-guarded),
  rolled up into `regressions`, `improvements`, and a verdict. Deterministic;
  `renderTrendReportMarkdown` renders it.
- **MCP tool `eve_compare_builds`** — studies each build URL and returns the
  trend (10 tools total).
- 8 tests (`tests/trends.test.ts`, incl. a bad→average→excellent construct
  check), `examples/continuous-regression.ts`, `docs/continuous-regression.md`.

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
