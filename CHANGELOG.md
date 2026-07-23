# Changelog

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
