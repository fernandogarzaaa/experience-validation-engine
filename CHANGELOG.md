# Changelog

## Unreleased — Phase 2: modality-variant kernel (Approach B)

The one-time core generalization, landed additively: the browser-flavored
`Percept`/`Action` pair now has a modality-agnostic kernel beneath it, MCP
runs kernel-natively, and scoring is registry-driven and modality-gated.
397 tests (22 new). Design doc: `docs/kernel.md`; debt retirement:
`docs/projection-debt-ledger.md` (entries 1–7 retired, 8 deferred).

### Added — the kernel (`src/core/kernel.ts`)

- `KernelPercept` (discriminated over `visual | textual`), `FrameIdentity`
  (`address`/`label`/`surfaceState` — frame identity independent of
  "page/URL"), `Affordance` (open, registry-aligned `kind`; `bbox` /
  `charCell` / `schemaPath` locators; perceived metadata bag), typed
  `SurfaceSignal`s (`tool-result` with explicit truncation semantics,
  `error` with `source`, `notification`, `surface-terminated`, …), and
  `KernelAction { verb, target?, payload? }`.
- Per-surface verb registries declared via `SurfaceCapabilities.actionVerbs`
  (`actionVerbsFor` defaults to the eleven legacy web kinds).
- `KernelSurface` adapter interface (`kernelPercept()` + `actKernel()`) with
  the `asKernelSurface` narrowing helper.

### Changed — compatibility (deprecated `WebPerceptView`, no behavior change)

- The legacy `Percept`/`Action` shapes remain the session contract as the
  deprecated web view: `kernelFromWebPercept` / `webPerceptFromKernel`
  project both ways (`src/surface/kernelView.ts`). Cognition additionally
  receives `CognitiveContext.kernel`; on web surfaces it is exactly the
  projection of the decision percept (shim-equivalence test pins identical
  session outcomes). All 375 pre-existing tests passed unchanged.
- `Action` gained `{ kind: "invoke"; verb; payload? }` for kernel-native
  acts; `describeAction` renders `invoke add({"a":2})`.

### Changed — MCP is kernel-native (`src/surface/mcp.ts`)

- One `tools/call` is one `mcp.invoke` action with typed arguments
  (`src/cognition/toolArgs.ts` — intent is a cognition decision; the
  adapter never coerces text). The catalog keeps schema + annotations as
  perceived metadata with stable `tool:<name>` identity across
  `list_changed`. Results, protocol errors, notifications and server death
  are distinct typed signals; the kernel carries full result text and
  reports web-view truncation explicitly. Structural frame headers are
  headings, so menu/form/result have distinct screen identities.
- The Phase-1 projection (form fill + Enter, error-as-dialog, truncated
  lines) survives only as the deprecated web view.

### Changed — registry-driven, modality-gated scoring

- `Finding.category` / `Score.dimension` are open, registry-backed types.
- `computeScores` honors `appliesTo`: visual-only dimensions are skipped
  (not vacuously passed) on textual sessions; `overall` renormalizes.
- One severity penalty schedule (`FINDING_SEVERITY_PENALTY` +
  `scoreFromFindings` in `src/scoring/scorer.ts`); registered dimensions
  (e.g. `mcp.*`) flow through the session scorer via
  `FindingCategoryEntry.scoresInto`, evidence-gated. The MCP harness's
  parallel scorer was retired onto it.

### Protocol

- **Wire impact: none.** `invoke` collapses to `click` in CP/1 `Experience`
  documents (additive `ACTION_MAP` entry, same policy as `doubleClick`). No
  canonical-form change; SPEC §8 not triggered; conformance fixtures
  unchanged.

## Unreleased — Phase 1: MCP server evaluation adapter

The second proof of the non-visual surface seam: EVE now evaluates arbitrary
MCP servers, via capability-flagged projection (Approach C — core
generalization stays Phase 2). 375 tests (20 new).

### Added — MCP surface adapter (`src/surface/mcp.ts`, `src/surface/mcpClient.ts`)

- **`McpAdapter`** projects an MCP server onto the textual seam: `tools/list`
  is the affordance menu, a tool's JSON Schema is its form, `tools/call` is
  the submission, results/notifications are the observation, errors are
  dialogs. Declares `TEXTUAL_SURFACE` honestly — the Phase-0 gate means no
  vision finding can fire. Transports: stdio (spawn the target) and
  Streamable HTTP. `notifications/tools/list_changed` refreshes the menu live.
- **Persona-driven operation**: `eve run "mcp:node server.js" --goal "…"` runs
  the full human loop (cognition, emotion, patience, scoring, reports)
  against an MCP server unchanged.
- `connectMcpInProcess(server)` evaluates in-process SDK servers — tests and
  dogfooding (EVE can evaluate itself).

### Added — deterministic MCP oracles (`src/mcpEval/`, `eve mcp-eval`)

- **Schema oracle**: object-schema validity, dangling `required`, description
  presence/quality, annotation honesty (name vs readOnly/destructive hints).
- **Conformance oracle**: initialize/serverInfo, `capabilities.tools`
  declaration, ping, unknown-tool → protocol error (not fake success/crash).
- **Fuzz oracle**: seeded adversarial inputs (missing required, type
  violations, boundary values, oversized payloads) classified as
  protocol-error / error-result / accepted-invalid / hang / crash; a crash
  is critical and stops fuzzing.
- `evaluateMcpServer(target)` → evidence-backed `McpEvalReport` with
  `mcp.schemaQuality` / `mcp.robustness` / `mcp.conformance` scores (100
  minus the scorer's penalty schedule). `eve mcp-eval` exits 1 on any
  critical finding — CI-gate friendly.
- **Vocabulary** registered via the Phase-0 registries
  (`registerMcpVocabulary`, idempotent): three dimensions and three finding
  categories (`appliesTo: ["textual"]`, evidence mandatory) and the
  engine-side `mcp.invoke` verb (`onCp1Wire: false`).

### Added — projection debt ledger (`docs/projection-debt-ledger.md`)

Every place the projection strains the browser-flavored contract, with
Phase-2 cost estimates — the measurement instrument for scoping Approach B.
User docs in `docs/mcp-adapter.md`.

## Unreleased — Phase 0: honesty layer & vocabulary registries

Expansion groundwork: a confirmed engine-level honesty bug is fixed, and the
three closed vocabulary unions become registries so future domain packs can
extend them without touching core. Fully backwards compatible — no score,
report, or CP/1 document changes.

### Fixed — engine-level capability-gate bypass

- **`runVisionChecks` now honors `capabilities.spatial`** (`src/engine/session.ts`).
  The session loop ran geometry/pixel vision checks unconditionally while
  plugins correctly gated on `capabilities.spatial`. On a textual surface the
  engine could emit valid-but-trivial findings (character-cell boxes flagged
  as tiny targets or clipped elements) — the "Axiom dashboard" failure mode
  the surface spec was written to prevent. The checks are now skipped, not
  failed, exactly as the spec promised. Regression tests in
  `tests/spatialGuards.test.ts` run a full session on a non-spatial fixture
  whose geometry *would* produce findings, and assert none are emitted.

### Added — vocabulary registries (`src/core/registry.ts`)

- **`ScoreDimension`, `FindingCategory` and CP/1's `ExperienceAction` are now
  registry-backed.** The shipped 16/10/9 values are pre-registered as
  built-ins with their serialized strings unchanged (the union types are now
  derived from const tuples, following the existing `EVENT_KINDS` pattern),
  so every consumer, stored report and conformance fixture behaves as before.
- **Dimension metadata.** Each `ScoreDimensionEntry` carries a published
  composite `weight` (the scorer remains the single source of truth — a
  registered dimension defaults to weight 0 and can never silently reweight
  existing scores) and an `appliesTo` modality field for the honesty layer.
  No consumer gates on `appliesTo` yet, so behavior is unchanged.
- **Evidence stays mandatory.** Dimension and category entries carry
  `evidenceRequired: true` as a type-level literal; new domains cannot
  register vibes-based scoring.
- **Plugin lifecycle hook `onRegister(registries)`** (`EvePlugin`, optional):
  the one place a plugin may register custom dimensions, finding categories
  or engine-side action verbs, invoked once at registration time by
  `PluginManager`. Domain packs can equally call `registerDimension`,
  `registerFindingCategory` and `registerActionVerb` directly.
- **CP/1 compatibility.** Registered values serialize as plain strings, like
  the built-ins, so document bytes and content hashes are unchanged and no
  protocol version bump is required. Custom action verbs are registered
  `onCp1Wire: false`: widening the canonical `ExperienceAction` set changes
  the canonical form, which SPEC §8 reserves for a protocol version change.

18 new tests (`tests/registries.test.ts`, plus 2 engine-guard tests in
`tests/spatialGuards.test.ts`); 355 total.

## 0.3.1 — Dogfooding fixes

Quality fixes surfaced by running EVE's own Phase-3 analysis against a model of
EVE's console, plus a reproducible example and guide for the practice
(`examples/eve-on-eve.ts`, [docs/dogfooding.md](docs/dogfooding.md)).

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
  `label` is the (optional) display name; renderers fall back to `url`, so
  existing behavior and existing constructors are unaffected.
- **Token normalization** — screen identifiers are normalized (camelCase split,
  separators to spaces) before keyword matching, so `newStudy` and
  `search-results` classify correctly and a hostname can no longer hijack a
  match.

9 new tests (`tests/dogfooding.test.ts`); 199 total.

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
