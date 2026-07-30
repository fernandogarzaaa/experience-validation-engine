/**
 * Defining a custom persona: a stressed nurse using clinical software during
 * a night shift — time-pressed, careful about destructive actions, tired.
 *
 *   npx tsx examples/custom-persona.ts
 */
import {
  DEMO_APP,
  EveSession,
  MockAdapter,
  buildReport,
  definePersona,
  renderMarkdown,
} from "../src/index.js";

const nightShiftNurse = definePersona({
  name: "night-shift-nurse",
  description:
    "Clinically expert but time-pressed and fatigued. Careful with anything destructive, intolerant of slow screens.",
  traits: {
    readingSpeedWpm: 260,
    patience: 0.25,
    riskTolerance: 0.15,
    thoroughness: 0.6,
    techLiteracy: 0.5,
    distractibility: 0.5,
    resilience: 0.4,
  },
  disposition: { fatigue: 0.5, stress: 0.45 },
});

const session = new EveSession({
  adapter: new MockAdapter(DEMO_APP),
  startUrl: "mock:landing",
  persona: nightShiftNurse,
  goal: "log in and find my notes",
  goalSuccessSignals: ["your notes"],
  seed: 21,
  maxSteps: 25,
  paceScale: 0,
  onLog: (line) => console.log(`  ${line}`),
});

const result = await session.run();
console.log(`\n${renderMarkdown(buildReport(result)).split("\n").slice(0, 30).join("\n")}`);
