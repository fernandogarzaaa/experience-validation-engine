# Developer Guide

## Install

```bash
npm install experience-validation-engine
# plus one browser backend (optional — the mock adapter needs nothing):
npm install playwright && npx playwright install chromium
```

Requirements: Node.js ≥ 20.

## Quick start (offline, 30 seconds)

```bash
npx eve run mock: --persona curious-explorer --steps 25
open .eve-output/report.html
```

`mock:` runs the built-in demo application in memory — no browser, no network.

## Quick start (real site)

```bash
npx eve run https://staging.your-app.example.com \
  --persona first-time-user \
  --goal "sign up for an account"
```

## Programmatic use

```ts
import {
  EveSession,
  PlaywrightAdapter,
  AccessibilityPlugin,
  PerformancePlugin,
  writeReports,
} from "experience-validation-engine";

const session = new EveSession({
  adapter: new PlaywrightAdapter({ headless: true }),
  startUrl: "https://staging.your-app.example.com",
  persona: "impatient-user",
  goal: "create a project and invite a teammate",
  goalSuccessSignals: ["invitation sent"],
  seed: 42,                        // reproducible sessions
  maxSteps: 60,
  screenshots: true,
  plugins: [new AccessibilityPlugin(), new PerformancePlugin()],
  onLog: (line) => console.log(line),
});

const result = await session.run();
await writeReports(result, ".eve-output");

const overall = result.scores.find((s) => s.dimension === "overall")!;
if (overall.value < 60) process.exit(1);   // gate CI on experience quality
```

### Watching the session live

`EveSession.events` is a typed event bus:

```ts
session.events.on("loop:decide", ({ step, action, rationale }) => {
  console.log(step, rationale);
});
session.events.on("finding", ({ finding }) => {
  console.log(`[${finding.severity}] ${finding.title}`);
});
session.events.on("emotion:update", ({ emotion }) => {
  if (emotion.frustration > 0.7) console.warn("operator is about to snap");
});
```

Events: `session:start`, `session:end`, `loop:perceive`, `loop:decide`,
`loop:act`, `loop:outcome`, `loop:iteration`, `finding`, `goal:changed`,
`emotion:update`.

## Interpreting results

`SessionResult` contains:

- `scores` — 16 dimensions, 0..100, each with evidence strings.
- `findings` — deduplicated, severity-ranked issues with evidence and
  (usually) recommendations. `id` values (`F-001`…) are stable within a run.
- `iterations` — the full journal: every action, its first-person rationale,
  the prediction made, and the measured outcome.
- `emotionTimeline` — per-step snapshots of all nine emotions.
- `workflows` / `workflowNodes` / `workflowTransitions` — the discovered map.
- `endReason` — `goal-achieved` | `abandoned` | `step-budget-exhausted` |
  `time-budget-exhausted`.

**A session that ends in `abandoned` is a critical result by definition** —
a simulated user just churned. The abandonment reason and the emotional
timeline tell you where the experience broke.

## Reproducibility & comparison

Sessions are deterministic given (app state, persona, seed). Practical
patterns:

- **Regression**: pin a seed in CI; a changed action path or score after a
  deploy is a real behavioral difference in your product.
- **Coverage**: run the same config with several seeds to explore different
  plausible paths.
- **Population testing**: run the same seed across personas
  (see `examples/compare-personas.ts`) to see who your product fails.

## Phase 2 — enhanced cognition, learning, and the AI panel

Phase 2 is entirely **opt-in**. Every option below defaults to off, so
existing sessions and reports are byte-for-byte unchanged. Turn a capability
on only when you want it.

### Enhanced cognition (CLI: `--cognitive`, `--utility`)

```ts
import { EveSession, MockAdapter, DEMO_APP, UtilityCognition } from "experience-validation-engine";

const result = await new EveSession({
  adapter: new MockAdapter(DEMO_APP),
  startUrl: "mock:landing",
  persona: "first-time-user",
  cognitive: true,                // selective attention, cognitive load,
                                  // trust, and the expectation engine
  policy: new UtilityCognition(), // utility-based choice (softmax over
                                  // emotion-weighted expected value)
}).run();

result.cognitiveLoad;       // per-step NASA-TLX-style intrinsic/extraneous load
result.attention;           // fixations per step + count of missed changes
result.trustTimeline;       // trust rising/eroding across the session
result.expectationTimeline; // predictions vs. disconfirmations
```

Pass `cognitive: { attention: true, cognitiveLoad: false, ... }`
(`CognitiveConfig`) to enable individual subsystems instead of the whole
suite.

### Long-term memory & learning (CLI: `--remember <file.json>`)

```ts
import { InMemoryStore, FileMemoryStore } from "experience-validation-engine";

const store = new FileMemoryStore(".eve-memory.json"); // or new InMemoryStore()
const result = await new EveSession({
  adapter, startUrl, persona: "power-user",
  longTermMemory: store,    // carries learned app knowledge across runs;
                            // FileMemoryStore loads/persists automatically
}).run();

result.learningMetrics;     // step/time reduction vs. earlier sessions
```

Run the same config repeatedly and the operator reaches the goal in fewer
steps (power law of practice). See `examples/learning-across-sessions.ts`.

### Social & cultural overlays (CLI: `--profession`, `--culture`)

The culture is a session option; the profession is applied to the persona:

```ts
import { getPersona, getProfession, applyProfession } from "experience-validation-engine";

const result = await new EveSession({
  adapter, startUrl,
  persona: applyProfession(getPersona("office-worker"), getProfession("accountant")),
  culture: "de-DE",         // reading direction, formality, patience norms
}).run();
```

Discover the catalogs with `eve professions` / `eve cultures`.

### Behavioral & temporal regression

```ts
import { compareExperience } from "experience-validation-engine";

const report = compareExperience(baseline, candidate, { baseline: "v1.0", candidate: "v1.1" });
if (report.verdict === "regressed") process.exit(1); // UX regressed even if tests are green
report.regressions; // the metrics that moved the wrong way, with deltas
```

`report` (`RegressionReport`) carries per-metric deltas, the regressed
subset, and a verdict of `improved | unchanged | regressed`. See
`examples/behavioral-regression.ts`.

### The AI evaluation panel (CLI: `--panel`)

```ts
import { runPanel, renderPanelMarkdown } from "experience-validation-engine";

const panel = runPanel([result]);        // accepts one or many sessions
panel.critique;    // design critic (Nielsen heuristics, evidence-linked)
panel.forecast;    // experience forecast for upcoming sessions
panel.executive;   // moderator synthesis (consensus issues, disagreements)
panel.plan;        // PM-prioritized (RICE) epics/stories/roadmap
panel.tickets;     // developer-ready tickets
console.log(renderPanelMarkdown(panel));
```

See `examples/ai-panel.ts`.

### Collaborative multi-operator sessions

```ts
import { runCollaborative } from "experience-validation-engine";
```

Models a handoff / approval chain across several operators. See
`examples/collaborative-workflow.ts`.

### Benchmarks (CLI: `eve benchmark`)

`eve benchmark` runs EVE against known-good / known-bad reference apps and
exits non-zero if it cannot rank them correctly — a construct-validity gate
for the instrument itself. Import the suite via `validateBenchmarks()`.

## Pacing

Real browsers are paced at `paceScale` × human speed (default 0.15). The
*simulated clock* — used for the report timeline and perceived-latency
reasoning — always advances at full human speed, so reports read in human
time regardless of how fast the run executed.

## Testing your integration

Use `MockAdapter` with your own `MockAppSpec` to unit-test personas,
policies and plugins without a browser — see `src/browser/mock.ts` and
`tests/engine.test.ts` for the pattern.

## Repository development

```bash
git clone https://github.com/fernandogarzaaa/experience-validation-engine
cd experience-validation-engine
npm install
npm run lint        # Biome: lint, format, import order
npm run typecheck   # strict TS, no emit
npm test            # vitest, fully offline
npm run coverage    # same suite + coverage, enforces thresholds
npm run build       # emit dist/
npx tsx examples/basic-run.ts
```

`npm run lint:fix` applies the safe fixes, and `npm run format` formats
without linting. Biome's configuration lives in `biome.jsonc`.

### Real-browser tests

`npm test` never touches a browser or the network — that constraint is what
makes it fast enough to gate CI on. The adapter contract is verified
separately:

```bash
npx playwright install chromium
npm run test:browser
```

This drives Chromium against a loopback fixture site and checks the whole
`BrowserAdapter` contract: perception, clicking, typing, scrolling, history,
native dialogs, screenshots, and a full session end to end. It exists because
the adapters are typed against hand-written duck types for the driver's
`Page`, so `tsc` cannot detect upstream API drift — and neither can
`MockAdapter`, which has no asynchronous navigation. Run it whenever you touch
`src/browser/` or the perception script.

### Coverage

Thresholds are set just below the measured baseline and act as a ratchet
against regression, not as a target. The report is written to `coverage/`;
CI uploads it as an artifact on every run.

### Docker

```bash
docker build -t eve .
docker run --rm eve run mock: --persona first-time-user
docker run --rm -v "$PWD/out:/work/.eve-output" eve run https://example.com
```

The image is built on Playwright's, so real-browser runs work without
installing anything locally. The MCP server speaks stdio and works over
`docker run -i --entrypoint eve-mcp eve`.
