/**
 * Collaborative workflow: multiple operators, an approval chain, and a
 * handoff. Models a shared workflow where one role's incomplete work blocks
 * the next — a failure mode functional testing of each screen in isolation
 * cannot see.
 *
 *   npx tsx examples/collaborative-workflow.ts
 */
import { runCollaborative, MockAdapter, DEMO_APP } from "../src/index.js";

const result = await runCollaborative({
  name: "Note creation & review",
  adapterFactory: () => new MockAdapter(DEMO_APP),
  startUrl: "mock:login",
  seed: 7,
  cognitive: true,
  roles: [
    {
      name: "Author",
      persona: "office-worker",
      goal: "log in and open my notes",
      goalSuccessSignals: ["your notes"],
      maxSteps: 20,
    },
    {
      name: "Reviewer",
      persona: "power-user",
      goal: "review settings and confirm",
      goalSuccessSignals: ["settings"],
      startUrl: "mock:dashboard",
      maxSteps: 15,
    },
  ],
});

console.log(result.summary);
console.log(`\nChain completed: ${result.chainCompleted}`);
console.log("\nHandoffs:");
for (const h of result.handoffs) {
  console.log(`  ${h.from} → ${h.to}: ${h.note}`);
}
console.log("\nPer role:");
for (const r of result.roleResults) {
  console.log(`  ${r.role}: ${r.result.endReason} (${r.result.usage.steps} steps, score ${r.result.scores.find((s) => s.dimension === "overall")!.value})`);
}
if (result.breakdown) console.log(`\n⚠ Breakdown at "${result.breakdown.role}": ${result.breakdown.reason}`);
