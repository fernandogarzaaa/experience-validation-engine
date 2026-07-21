# Roadmap

EVE 0.1 ships the complete cognitive simulation core. This roadmap describes
where the project goes next, in rough priority order. Items marked 🤝 are
great first contributions.

## 0.2 — Perception depth

- **OCR-grade retina**: optional screenshot-based text extraction (replacing
  the DOM-derived retina abstraction with true pixel reading) so EVE can
  evaluate canvas-, WebGL- and image-heavy UIs.
- **Animation perception**: frame-sequence sampling to perceive transitions,
  janky scrolling and layout shift the way a human notices them.
- **Sound (future support)**: perceive audible feedback/alerts via a browser
  audio-capture channel.
- 🤝 More visual checks: inconsistent button styles across screens, dark-mode
  contrast auditing, responsive breakpoints (run the same session at three
  viewports and diff findings).

## 0.3 — Cognition depth

- **Reading order modeling**: F-pattern/Z-pattern gaze simulation so what
  the operator "reads first" matches eye-tracking research.
- **Habituation**: banner blindness — repeated exposure lowers the salience
  of unchanged regions.
- **Multi-session memory**: persist semantic/spatial memory between sessions
  to simulate a returning user and measure re-learnability.
- 🤝 More exploration strategies (breadth-first audit, task-batch).

## 0.4 — Platforms

- **Mobile web**: touch actuation model (fat-finger scatter, swipe
  gestures, soft-keyboard typing) on emulated devices.
- **Desktop automation adapter**: OS-level adapter (e.g. via accessibility
  APIs) for Electron/native apps — the adapter contract already supports it.
- **Native mobile adapter**: Appium-backed adapter.
- 🤝 WebDriver BiDi adapter.

## 0.5 — Judgment & ecosystem

- **Plugin registry**: npm-namespaced plugin discovery
  (`eve-plugin-*`), loadable from YAML.
- **Localization plugin**: run per-locale, flag untranslated/overflowing
  strings.
- **Security-UX plugin**: deceptive-pattern detection (confirm-shaming,
  disguised ads, forced continuity).
- **Design-review plugin**: design-token conformance from declared styles.
- **Analytics plugin**: verify that key interactions would have fired
  instrumentation (opt-in bridge — a deliberate, documented exception to
  the no-privileged-information rule, clearly separated from cognition).

## 0.6 — Scale & product

- **Cohort runs**: one command, N personas × M seeds, aggregated
  population-level report ("34% of simulated users abandoned checkout").
- **Longitudinal dashboards**: score trends across builds; experience
  regression bisection.
- **Session replay export**: portable trace format + viewer.
- **Multi-operator sessions**: two simulated users collaborating (shared
  documents, chat) to evaluate multiplayer UX.

## Non-goals

- Replacing functional test suites — EVE evaluates experience, not
  correctness; run both.
- Pixel-perfect visual diffing against golden screenshots — dedicated tools
  do that better; EVE cares about *perceived* breakage.
- Load testing.
