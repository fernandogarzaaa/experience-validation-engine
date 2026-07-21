# Developer Guide

## Install

```bash
npm install experience-validation-engine
# plus one browser backend (optional — the mock adapter needs nothing):
npm install playwright && npx playwright install chromium
```

Requirements: Node.js ≥ 18.17.

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
npm run typecheck   # strict TS, no emit
npm test            # vitest, fully offline
npm run build       # emit dist/
npx tsx examples/basic-run.ts
```
