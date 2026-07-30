/**
 * Basic run: a first-time user explores the built-in mock application and
 * EVE writes a full experience report. Runs completely offline.
 *
 *   npx tsx examples/basic-run.ts
 *
 * In your own project, import from "experience-validation-engine" instead
 * of the relative path.
 */
import {
  AccessibilityPlugin,
  DEMO_APP,
  EveSession,
  MockAdapter,
  PerformancePlugin,
  writeReports,
} from "../src/index.js";

const session = new EveSession({
  adapter: new MockAdapter(DEMO_APP),
  startUrl: "mock:landing",
  persona: "first-time-user",
  seed: "demo",
  maxSteps: 30,
  paceScale: 0,
  plugins: [new AccessibilityPlugin(), new PerformancePlugin()],
  onLog: (line) => console.log(`  ${line}`),
});

const result = await session.run();
const written = await writeReports(result, ".eve-output/basic-run");

const overall = result.scores.find((s) => s.dimension === "overall")?.value;
console.log(`\nOverall experience: ${overall}/100 (${result.endReason})`);
console.log(`Findings: ${result.findings.length}`);
console.log(`Report: ${written.html}`);
