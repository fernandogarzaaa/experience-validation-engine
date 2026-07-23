# API Reference

All symbols are exported from the package root
(`import { ... } from "experience-validation-engine"`). Types are strict;
this page lists the load-bearing surface — see the `.d.ts` files for full
signatures.

## Engine

### `new EveSession(options: SessionOptions)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `adapter` | `BrowserAdapter` | — | required |
| `startUrl` | `string` | — | required |
| `persona` | `Persona \| string` | `"first-time-user"` | name resolves via built-in registry |
| `policy` | `DecisionPolicy` | `HeuristicCognition` | |
| `plugins` | `EvePlugin[]` | `[]` | |
| `goal` | `string` | open-ended exploration | |
| `goalSuccessSignals` | `string[]` | `[]` | all must appear to succeed |
| `seed` | `number \| string` | derived from persona+url | |
| `maxSteps` | `number` | `60` | |
| `maxDurationMs` | `number` | `600000` | |
| `viewport` | `Viewport` | `1280×800` | |
| `screenshots` | `boolean` | `false` | |
| `paceScale` | `number` | `0.15` | real-browser pacing multiplier |
| `onLog` | `(line) => void` | — | progress lines |

- `session.run(): Promise<SessionResult>`
- `session.events: EventBus` — typed subscription (`EveEventMap`).

### `SessionResult`

`iterations`, `findings`, `scores`, `emotionTimeline`, `workflows`,
`workflowNodes`, `workflowTransitions`, `screenshots`, `usage`,
`goalAchieved`, `abandoned`, `abandonReason`, `endReason`, `appTheory`,
`personaName`, `seed`, `startUrl`.

## Browser layer

- `interface BrowserAdapter` — `open`, `snapshot`, `screenshot`,
  `moveMouse`, `clickAt`, `doubleClickAt`, `typeText`, `pressKey`,
  `scrollBy`, `goBack`, `navigate`, `close`.
- `PlaywrightAdapter(options?)`, `PuppeteerAdapter(options?)`,
  `SeleniumAdapter(options?)` — optional-peer-backed; throw with install
  instructions when the peer is missing.
- `MockAdapter(app?: MockAppSpec)` + `DEMO_APP` — in-memory application.
- `createAdapter(name, options)` — factory for `"playwright" | "puppeteer" |
  "selenium" | "mock"`.
- Humanizer: `planClick(target, persona, rng)`, `planTyping(text, persona,
  rng)`, `hesitationMs(risk, persona, rng)`.
- `PERCEPTION_SCRIPT` — the injected retina script (adapter authors).

## Personas

- `definePersona(spec: PersonaSpec): Persona` — validates ranges.
- `getPersona(name)`, `listPersonas()`, `registerPersona(persona)`.
- Trait translation: `readingTimeMs`, `motorActionMs`, `typingIntervalMs`,
  `clickScatterPx`, `workingMemoryCapacity`, `abandonmentThreshold`.
- Constants: `BASELINE_TRAITS`, `DEFAULT_ACCESSIBILITY`.

## Cognition

- `interface DecisionPolicy { name; decide(ctx): Promise<Decision> }`
- `HeuristicCognition(strategy?)` — offline default.
- `LlmCognition(options?)` — Anthropic-backed; graceful fallback.
- Mental model: `predictInteraction`, `comparePrediction`,
  `perceivesError`, `errorSnippets`, `inferAppTheory`, `tokenize`,
  `visibleText`.
- Attention: `scoreAffordances`, `prominenceOf`, `goalRelevanceOf`,
  `riskOf`, `readingLoad`, `choiceLoad`.

## Memory, emotion, planning

- `OperatorMemory` — `hold`, `recordEpisode`, `decayEpisodes`,
  `recallEpisodes`, `remembersFailure`, `learn`, `knownFacts`,
  `observeScreen`, `recordTransition`, `knownScreens`, `loopingScore`,
  `trail`; `screenSignature(percept)`.
- `EmotionalState` — `get`, `snapshot`, `adjust`, `decay`, `record`,
  `timeline`, `mean`, `peak`; `appraise(...)`, `decayRate(...)`.
- `GoalStack`, `createGoal(description, options?)` — keyword expansion via
  conventional associations; subgoal push/resolve.

## Vision

- Geometry: `checkGeometry(percept, accessibilityProfile)`.
- Pixels: `checkPixels(percept)`, `checkRegression(prevShot, shot,
  sameText)`.
- Utilities: `decodePng`, `frameDiffRatio`, `luminanceVariance`,
  `relativeLuminance`, `contrastRatio`, `parseHexColor`,
  `sampleLuminances`, `simulateColorVision`.

## Workflow

- `detectWorkflow(percept): { kind, confidence }`
- `WorkflowGraph` — `observe`, `allNodes`, `allTransitions`,
  `discoveredWorkflows`, `revisitRatio`.
- `WORKFLOW_SIGNATURES` — extend to teach EVE new workflow types.

## Scoring & reporting

- `computeScores(input: ScoringInput): Score[]` — 16 dimensions.
- `buildReport(result): ExperienceReport`
- `renderHtml(report)`, `renderMarkdown(report)`, `renderJson(report)`
- `writeReports(result, outputDir)` — writes all three.

## Plugins

- `interface EvePlugin` — `onSessionStart?`, `onPercept?`, `onOutcome?`,
  `onSessionEnd?`.
- `PluginManager`, `AccessibilityPlugin`, `PerformancePlugin`,
  `LlmCriticPlugin(options?)`.

## Configuration

- `resolveConfig(raw): EveConfig` — validate an object.
- `loadConfigFile(path): Promise<EveConfig>` — YAML.
- `DEFAULT_CONFIG`, `ConfigError`.

## Phase 2 — enhanced cognition & analysis

All phase-2 surface is exported from the package root and is opt-in;
nothing here changes a default (phase-1) session.

### Enhanced session options & results

`SessionOptions` gains: `cognitive?: boolean | CognitiveConfig`,
`longTermMemory?: PersistentMemory`, `culture?: CultureProfile | string`.
`SessionResult` gains: `capturedScreens` (always), and — when enabled —
`trustTimeline`, `cognitiveLoad`, `attention`, `expectationTimeline`,
`learningMetrics`, `journey`, `culture`.

- `UtilityCognition(strategy?)` — `DecisionPolicy` using utility-based choice
  (softmax over emotion-weighted expected value); drop-in for `policy`.
- `CognitiveSuite`, `CognitiveConfig`, `CognitiveLoadTimeline` — the
  per-step subsystem bundle (attention, cognitive load, trust, expectation).

### Long-term memory & learning

- `interface PersistentMemory` — `load()`, `save(memory)`.
- `InMemoryStore()`, `FileMemoryStore(path)` — implementations; pass as
  `longTermMemory`.
- `ApplicationMemory`, `emptyApplicationMemory()`,
  `computeLearningMetrics(memory) → LearningMetrics`.

### Social & cultural overlays

- `listProfessions()`, `getProfession(name)`,
  `applyProfession(persona, profession) → Persona`.
- `getCulture(locale)`, `CultureProfile`, `withCulture`, `cultureOf`,
  `CULTURES`, `DEFAULT_CULTURE`.

### Regression, forecasting, panel, benchmarks, collaboration

- `compareExperience(baseline, candidate, labels?) → RegressionReport`
  (`verdict: "improved" | "unchanged" | "regressed"`, `deltas`,
  `regressions`); `extractMetrics(result) → ExperienceMetrics`.
- `forecastExperience(sessions) → ExperienceForecast`.
- `runPanel(sessions) → PanelResult` (`{ executive, critique, forecast,
  plan, tickets }`); building blocks `critiqueDesign`, `forecastExperience`,
  `moderatePanel`, `buildProductPlan`, `generateTickets`; exporters
  `toGitHubIssues`, `toLinearIssues`, `toJiraIssues`, `toMarkdownTasks`;
  `renderPanelMarkdown(panel)`.
- `validateBenchmarks(options?) → BenchmarkValidation`; `BENCHMARK_APPS`,
  `EXCELLENT_APP`, `AVERAGE_APP`, `BAD_APP`, `BenchmarkTier`.
- `runCollaborative(scenario) → CollaborativeResult` — multi-operator
  handoff / approval chains.

## Core utilities

- `createRng(seed)`, `seedFromString(text)` — deterministic randomness.
- `EventBus` — typed async event bus.
- `describeAction(action)` — human-readable action strings.
