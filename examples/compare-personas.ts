/**
 * Persona comparison: run the same app with several personas and compare
 * how differently they experience it. This is EVE's core value: the same
 * pixels produce different experiences for different humans.
 *
 *   npx tsx examples/compare-personas.ts
 */
import { EveSession, MockAdapter, DEMO_APP } from "../src/index.js";

const personas = ["power-user", "first-time-user", "elderly-user", "impatient-user"];
const rows: Array<{ persona: string; overall: number; findings: number; end: string }> = [];

for (const persona of personas) {
  const session = new EveSession({
    adapter: new MockAdapter(DEMO_APP),
    startUrl: "mock:landing",
    persona,
    goal: "create a note and save it",
    goalSuccessSignals: ["your notes"],
    seed: 1000,
    maxSteps: 25,
    paceScale: 0,
  });
  const result = await session.run();
  rows.push({
    persona,
    overall: result.scores.find((s) => s.dimension === "overall")?.value ?? 0,
    findings: result.findings.length,
    end: result.endReason,
  });
}

console.log("\nPersona            Overall  Findings  Outcome");
console.log("─".repeat(52));
for (const row of rows) {
  console.log(
    `${row.persona.padEnd(18)} ${String(row.overall).padStart(5)}   ${String(row.findings).padStart(6)}    ${row.end}`,
  );
}
