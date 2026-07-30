/**
 * Cross-session learning: the same operator uses the same app several times
 * and gets measurably more efficient — remembering layouts, paths and
 * shortcuts between sessions (persistent episodic memory).
 *
 *   npx tsx examples/learning-across-sessions.ts
 */
import { writeFile } from "node:fs/promises";
import {
  DEMO_APP,
  EveSession,
  InMemoryStore,
  MockAdapter,
  UtilityCognition,
} from "../src/index.js";
import type { SessionResult } from "../src/index.js";
import { renderLearningCurveSvg } from "../src/index.js";

const store = new InMemoryStore();
let last: SessionResult | undefined;

for (let s = 1; s <= 5; s++) {
  const session = new EveSession({
    adapter: new MockAdapter(DEMO_APP),
    startUrl: "mock:landing",
    persona: "first-time-user",
    policy: new UtilityCognition(),
    cognitive: true,
    longTermMemory: store, // the operator remembers between sessions
    goal: "create a note and save it",
    goalSuccessSignals: ["your notes"],
    seed: 42,
    maxSteps: 40,
    paceScale: 0,
  });
  last = await session.run();
  const lm = last.learningMetrics!;
  console.log(
    `session ${s}: steps=${last.usage.steps}, confidence=${(last.emotionTimeline.at(-1)?.values.confidence ?? 0).toFixed(2)}, recognized ${lm.recognizedScreens} screen(s)`,
  );
}

const lm = last!.learningMetrics!;
console.log(`\nLearning rate (power-law α): ${lm.learningRate} (fit R²=${lm.learningFit})`);
console.log(`Steps per session: ${lm.stepsSeries.join(" → ")}`);
console.log(
  `Latest session takes ${Math.round(lm.timeReductionRatio * 100)}% of the first session's time`,
);
console.log(
  `Retention: ${(lm.retention * 100).toFixed(0)}% · recognition:recall ratio ${lm.recognitionRecallRatio}`,
);

await writeFile(".eve-output/learning-curve.svg", renderLearningCurveSvg(lm), "utf8");
console.log("\nLearning curve written to .eve-output/learning-curve.svg");
