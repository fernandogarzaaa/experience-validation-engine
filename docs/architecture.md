# Architecture

EVE is an autonomous cognitive simulation engine. It does not test whether
software is *correct*; it evaluates what software *feels like* to a specific
human. This document explains how the pieces fit together and, more
importantly, the constraints that shape them.

## The prime directive: no privileged information

The simulated operator may only act on what a human could perceive through a
screen. It cannot inspect source code, databases, backend logs, the browser
console, network responses, framework internals or component trees.

This constraint is enforced structurally, not by convention:

- The **perception script** (`src/browser/perceptionScript.ts`) is the only
  channel from the application to the operator. It walks the *rendered* page
  and returns only visible text, geometry, and coarse affordance cues —
  discarding hidden subtrees, zero-area boxes and off-screen content.
- Everything downstream consumes an immutable **`Percept`**
  (`src/core/types.ts`): URL bar, tab title, visible elements, dialogs,
  loading indicators, scroll extent and an optional screenshot. If it is not
  in the percept, the mind cannot know it.

We call the perception script the *retina abstraction*: it stands in for
OCR + visual object recognition, restricted to the information those would
yield. This is a deliberate engineering trade-off — for the overwhelming
majority of pages, running real OCR on screenshots would produce the same
inputs at 100× the cost and 10× the noise.

It is not, however, an *equivalence*, and the difference is not academic. The
DOM is what a page says about itself, and a page can be wrong: it can offer a
control that is never drawn, carry text a stylesheet or a missing font ate on
the way to the screen, or paint content into a canvas with nothing in the
markup to represent it. That last case is invisible to the perception script
in principle — there is nothing there to walk.

So the pixels are read separately, and the two accounts are compared. See
[docs/rendering.md](rendering.md). That check does not OCR either: to report
that a person can see something the page does not account for, it is enough to
establish that legible content is rendered there.

## The human loop

Every iteration of `EveSession.run()` (`src/engine/session.ts`) executes:

```
Observe → Interpret → Update Mental Model → Predict → Decide → Interact
   ↑                                                              │
   └── Adjust Internal State ← Compare Prediction vs Reality ← Observe Again
```

There are no scripts and no selectors. Each step is decided fresh by the
cognition policy from the current percept plus the operator's internal state.
Two consequences:

1. **Reproducibility** — all randomness flows through a seeded RNG
   (`src/core/random.ts`), so a session is a pure function of
   (application state, persona, seed).
2. **Emergence** — behavior like "went in circles, got frustrated, gave up"
   is not programmed anywhere; it emerges from the interaction of salience,
   memory, emotion and the abandonment threshold.

## Module map

```
src/
├── core/          Types, seeded RNG, typed event bus
├── engine/        EveSession: the human loop orchestrator
│                  + cognitiveSuite: phase-2 per-step subsystems (opt-in)
├── browser/       Adapters (Playwright/Puppeteer/Selenium/Mock),
│                  perception script, humanizer (motor noise, typos)
├── observation/   Percept construction + perceived-latency measurement
├── vision/        Pixel analysis (pngjs): contrast, diffing, blank screens;
│                  geometry analysis: overflow, overlap, misalignment;
│                  color-vision simulation
├── personas/      Trait model + 17 built-in personas + trait→behavior math
│                  + professions (social overlays) + cultures (locale profiles)
├── cognition/     Mental model, salience, prediction/comparison,
│                  HeuristicCognition (default), LlmCognition,
│                  UtilityCognition (utility-based decisions),
│                  attention (selective attention), expectation engine,
│                  cognitiveLoad (Cognitive Load Index)
├── planning/      Goal stack, keyword semantics, exploration strategies
├── memory/        Working / episodic / semantic / spatial memory + forgetting;
│                  longTerm (persistent cross-session store) + learning metrics
├── emotion/       9-emotion state vector + appraisal rules + decay
│                  + trust model (predictability/consistency/recovery/...)
├── workflow/      Workflow signature catalog, detector, graph, journey discovery
├── scoring/       Evidence-backed 16-dimension scoring
├── regression/    Temporal + behavioral experience regression
├── forecasting/   Predict future struggle / abandonment / confidence drains
├── panel/         AI panel: design critic, moderator, product manager, developer
├── benchmarks/    Known-quality apps + construct-validity harness
├── collaborative/ Multi-operator sessions, handoffs, approval chains
├── plugins/       Plugin contract + accessibility/performance/LLM-critic/localization
├── reporting/     Report assembly + HTML/Markdown/JSON + panel renderer
├── config/        YAML config schema + validation
└── cli/           The `eve` command
```

## Phase 2: the enhanced cognitive model

Phase 2 evolves the operator from a heuristic agent toward an inspectable
cognitive simulation, all **opt-in and backwards-compatible** (default
`EveSession` behavior is unchanged; the 59 phase-1 tests still pass). The
per-step subsystems — selective attention, utility-based decisions, the
expectation engine, cognitive-load estimation and the trust model — are
bundled in `engine/cognitiveSuite.ts` and activated by the `cognitive` option.
Cross-session learning is activated by supplying a `longTermMemory` store.
See [cognitive-model.md](./cognitive-model.md) and
[panel-and-analysis.md](./panel-and-analysis.md) for the full treatment, and
[research.md](./research.md) for the literature grounding every model.

The phase-1 `HeuristicCognition` was refactored to expose a single protected
`chooseAffordance` hook; `UtilityCognition` overrides only that step, reusing
the entire priority cascade — so the utility policy is a decision-model
upgrade, not a rewrite.

### Dependency rules (clean architecture)

- `core` depends on nothing.
- `browser` adapters implement a dumb actuate/perceive contract and never
  decide anything. The cognition engine cannot tell adapters apart. The one
  sanctioned exception is `attachOperator`: a surface whose *perceivability*
  depends on who is looking (a document's comprehension) is told the persona
  before it opens. It may shape what is perceivable; never what is decided.
- `humanity` is a surface, not a special case: it reads *digital output*
  (documents, decks, analytics exports, transcripts, payloads) through the
  same kernel, session loop and scoring as every driven surface. See
  [humanity-adapter.md](./humanity-adapter.md).
- `cognition` consumes percepts and internal state; it never touches the
  adapter. Decision-making and actuation are fully separated.
- `engine` is the only module that wires everything together.
- `plugins` observe; they can add findings but never influence behavior, so
  runs are comparable across plugin configurations.

## The cognitive model

The operator's continuously evolving internal state is spread across four
collaborating models, mirroring their human counterparts:

| Model | Module | Contents |
|---|---|---|
| Mental model | `cognition/mentalModel.ts` | Theory of the app, predictions, expectation checking |
| Memory | `memory/memory.ts` | Working (3–6 chunks), episodic (with forgetting curve + negativity bias), semantic (learned facts/shortcuts), spatial (screen graph) |
| Emotion | `emotion/` | confidence, frustration, trust, confusion, curiosity, fatigue, satisfaction, interest, stress — updated only via appraisal + decay |
| Goals | `planning/goals.ts` | Goal stack with transient subgoals (e.g. "recover from this error") |

**Prediction is the engine of evaluation.** Before every action the operator
predicts what will happen (from label semantics and conventions knowledge);
afterwards the prediction is compared against the next percept. The gap —
*surprise* — drives emotion (appraisal), learning (semantic memory), findings
(expectation violations) and scores (usability, learnability).

## The persona engine

A persona is 16 behavioral traits plus an accessibility profile
(`src/personas/persona.ts`). Traits are dimensionless 0..1 values that
downstream modules translate into concrete quantities:

- `readingSpeedWpm` → milliseconds spent on `read` actions
- `clickAccuracy` × target size → Gaussian click scatter → real misclicks
- `patience` → abandonment threshold, settle-wait tolerance
- `memoryRetention` → working memory capacity, episodic decay rate
- `riskTolerance` → hesitation before destructive controls, refusal to click them
- `keyboardPreference` / `keyboardOnly` → Tab/Enter navigation

Because the same trait feeds many behaviors, personas stay coherent: an
"elderly-user" *simultaneously* reads slowly, clicks imprecisely, refuses
risky buttons and forgets labels — as one person would.

## Decision policies

`DecisionPolicy` (`src/cognition/cognition.ts`) is the mind's contract:
percept + internal state in, one decision (action, rationale, prediction) out.

- **HeuristicCognition** (default, offline): a priority cascade — blocking
  dialog → loading → emotional bailout → read-new-screen → strong goal match
  → form filling → form submission → salience-weighted choice → scroll →
  backtrack → give up. Choices are softmax-weighted, not argmax, so behavior
  is human-variable yet seeded-reproducible.
- **LlmCognition** (optional): an Anthropic-powered policy that role-plays
  the persona given the same restricted information. Falls back to the
  heuristic policy on any failure, so sessions never die mid-run.

## Vision

Two layers, both operating on human-visible signals:

1. **Geometry** (works without screenshots): viewport clipping, horizontal
   overflow, overlapping controls, near-miss alignment, tiny text/targets,
   WCAG contrast from declared colors — including simulated protanopia /
   deuteranopia / tritanopia for color-blind personas.
2. **Pixels** (screenshot-based, via pngjs): luminance-variance blank-screen
   detection, sampled contrast estimation, and frame-diff visual-regression
   detection on revisits.

## Scoring & reporting

Scores (`src/scoring/scorer.ts`) are derived measurements with mandatory
evidence: expectation-violation rates, dead-click counts, emotion timelines,
revisit ratios, workflow completion, perceived-latency percentiles, findings.
Sixteen dimensions roll up into a weighted overall score capped by critical
findings.

Reports (`src/reporting/`) render the same assembled structure three ways:
self-contained HTML (inline SVG emotion timeline + interaction heatmap +
screenshots as data URIs), Markdown and JSON.

## Extension points

| To add… | Implement… |
|---|---|
| A browser/platform | `BrowserAdapter` (see `MockAdapter` as reference) |
| A judgment domain | `EvePlugin` (observe percepts/outcomes, report findings) |
| A different mind | `DecisionPolicy` |
| A user population | `definePersona()` / YAML `customPersonas` |
| A workflow type | extend `WORKFLOW_SIGNATURES` |
