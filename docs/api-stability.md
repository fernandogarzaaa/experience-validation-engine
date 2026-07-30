# API stability policy

EVE ships a large public surface: 30-plus modules, three generations of
capability, and an MCP server consumed by editors that upgrade on their own
schedule. This document says which parts you can build on, which parts will
move, and what a version number promises.

## Versioning

EVE follows semantic versioning, with the usual `0.x` caveat: **while the
major version is 0, a minor bump may contain a breaking change to an
experimental API.** Stable APIs do not break in a minor release regardless.

| Change | Version bump |
| --- | --- |
| Breaking change to a **stable** API | major (or, pre-1.0, a minor with a migration note in the changelog) |
| Breaking change to an **experimental** API | minor |
| New capability, backwards compatible | minor |
| Fix, docs, internal refactor | patch |

Two properties are treated as part of the contract at every tier, and a
change to either is breaking no matter which module it lives in:

- **Determinism.** The same `(appState, persona, seed)` produces the same
  run. If a release would change what a given seed does, that is called out
  in the changelog explicitly, because it invalidates stored baselines.
- **The prime directive.** Cognition acts only on human-perceivable
  information. No release relaxes this.

## Tiers

### Stable

Phase-1 core. These have been in place since 0.1.0, are what the CLI and
almost every example are built on, and are the most heavily tested paths in
the suite.

- `EveSession`, `SessionOptions`, `SessionResult`
- Core types: `Percept`, `VisibleElement`, `Action`, `Finding`, `Score`,
  `LoopIteration`, `SessionUsage`, and the enums they reference
- `BrowserAdapter` and the shipped adapters, including `MockAdapter` and
  `MockAppSpec`
- The persona model: `Persona`, traits, `getPersona`, `listPersonas`
- `DecisionPolicy` and `HeuristicCognition`
- The plugin interface (`EvePlugin`) and shipped plugins
- Reporting entry points (`writeReports`) and the report formats
- Configuration file schema (`eve.config.yaml`)
- `createRng` / `seedFromString`

Changes here get a deprecation period: the old form keeps working for at
least one minor release, warns, and the changelog documents the migration.

### Provisional

Phase-2 opt-in cognitive systems. Shipped, tested, and used in anger, but
the shapes are still settling as more of the cognitive model lands.

- `CognitiveSuite`, `CognitiveConfig`, `CognitiveLoadTimeline`
- `UtilityCognition` and the utility/expectation types
- Long-term memory stores (`PersistentMemory`, `FileMemoryStore`)
- Trust, attention and expectation timelines on `SessionResult`
- `src/regression/`, `src/forecasting/`, `src/panel/`, `src/benchmarks/`,
  `src/collaborative/`

Field *additions* to result objects should be expected at any time. Fields
are not removed or repurposed without a changelog entry.

### Experimental

Phase-3 systems. These are the newest, the least constrained by existing
consumers, and the most likely to change shape as the research behind them
develops. Build on them — that is what they are for — but pin your version
and read the changelog before upgrading.

- `src/population/`, `src/research/`, `src/study/`, `src/product/`
- `src/trends/`, `src/appmap/`, `src/predict/`
- `src/twins/`, `src/calibration/`, `src/multimodal/`, `src/evebench/`

Specifically expect movement in: report and dataset shapes, scoring and
weighting internals, and the naming of analysis outputs. The *inputs*
(sessions, personas, seeds) are stable — it is the analysis layer on top
that is still moving.

### Internal

Anything not exported from `src/index.ts` is internal, including everything
reachable by a deep import into `src/`. The package exports map only exposes
`.` and `./mcp`; deep paths are not part of the API and can move in a patch
release.

## The MCP surface

MCP tool **names** and their input schemas are treated as stable: editors
and agents bind to them by name, and a rename breaks a user's workflow
silently. Adding a tool, or adding an optional input to an existing tool, is
a minor release.

Tool *output* follows the tier of the system it wraps. `eve_run_session`
output is stable; `eve_product_report`, `eve_application_map`, `eve_bench`
and the other Phase-3 tools return experimental shapes. Every tool returns
both `markdown` and `structured` — if you are parsing, parse `structured`
and treat unknown fields as additive.

## Deprecation

A deprecated stable API is marked `@deprecated` in the types with the
replacement named, keeps working for at least one minor release, and is
listed in the changelog under the release that deprecated it and again under
the release that removed it.

## What this policy does not cover

- **Score values are not an API.** Improving the cognitive model changes
  scores by design; that is the product working, not a regression. Pin a
  version if you gate CI on absolute thresholds, and prefer
  `src/trends/`-style relative comparison between builds of *your* app.
- **The mock app** (`DEMO_APP`) is a fixture, not a contract. It changes
  when it needs to exercise something new.
