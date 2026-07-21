# Changelog

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
