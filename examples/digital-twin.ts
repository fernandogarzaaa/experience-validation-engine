/**
 * Phase 3 — Human digital twins.
 *
 * A digital twin is a persistent, named user model that evolves across
 * sessions: it remembers the apps it has used, grows more expert, and its
 * confidence baseline drifts toward its lived experience. Here "Power User A"
 * uses the same app five times and gets faster and more confident.
 *
 * Run:
 *   npx tsx examples/digital-twin.ts
 */

import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { createTwin, renderTwinMarkdown, runTwinSession } from "../src/twins/index.js";

let twin = createTwin({ id: "power-user-a", name: "Power User A", basePersona: "power-user" });

process.stdout.write("Session : steps  score  expertise  confidence\n");
for (let i = 0; i < 5; i += 1) {
  const { twin: evolved, outcome } = await runTwinSession(twin, {
    adapter: new MockAdapter(DEMO_APP), // swap for a real adapter + URL
    url: "mock:",
    goal: "create a note and save it",
    seed: 1, // same seed each time — improvement comes from the twin's memory
    maxSteps: 40,
  });
  twin = evolved;
  const e = twin.evolution;
  process.stdout.write(
    `   ${i + 1}    : ${String(outcome.steps).padStart(5)}  ${String(outcome.overall).padStart(5)}  ` +
      `${String(Math.round(e.expertise * 100)).padStart(8)}%  ${e.confidenceBaseline}\n`,
  );
}

process.stdout.write(`\n${renderTwinMarkdown(twin)}\n`);
