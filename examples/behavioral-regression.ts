/**
 * Behavioral regression: catch a UX regression that functional tests miss.
 *
 * Both "builds" of the app let the user finish the task, so a functional
 * test suite stays green. But the candidate build adds friction — more
 * steps, an error, lower confidence and trust — a genuine experience
 * regression EVE detects and functional testing cannot.
 *
 *   npx tsx examples/behavioral-regression.ts
 */
import { EveSession, MockAdapter, compareExperience } from "../src/index.js";
import type { MockAppSpec } from "../src/index.js";

const baselineBuild: MockAppSpec = {
  name: "Checkout",
  start: "cart",
  screens: [
    {
      id: "cart",
      title: "Cart",
      elements: [
        { role: "heading", text: "Your cart" },
        { role: "button", text: "Checkout", goto: "pay" },
      ],
    },
    {
      id: "pay",
      title: "Payment",
      elements: [
        { role: "heading", text: "Payment" },
        { role: "textbox", text: "Card number", editable: true },
        { role: "button", text: "Pay now", goto: "done" },
      ],
    },
    {
      id: "done",
      title: "Thank you",
      elements: [{ role: "heading", text: "Order confirmed — thank you" }],
    },
  ],
};

// Candidate build: still works, but adds an interstitial upsell + a
// validation error before success.
const candidateBuild: MockAppSpec = {
  name: "Checkout",
  start: "cart",
  screens: [
    {
      id: "cart",
      title: "Cart",
      elements: [
        { role: "heading", text: "Your cart" },
        { role: "button", text: "Checkout", goto: "upsell" },
      ],
    },
    {
      id: "upsell",
      title: "Wait!",
      elements: [
        { role: "heading", text: "Add protection plan?" },
        { role: "button", text: "No thanks", goto: "pay" },
        { role: "button", text: "Add it", goto: "pay" },
      ],
    },
    {
      id: "pay",
      title: "Payment",
      elements: [
        { role: "heading", text: "Payment" },
        { role: "textbox", text: "Card number", editable: true },
        { role: "button", text: "Pay now", goto: "err" },
      ],
    },
    {
      id: "err",
      title: "Error",
      elements: [
        { role: "heading", text: "Invalid — please try again" },
        { role: "button", text: "Retry", goto: "done" },
      ],
    },
    {
      id: "done",
      title: "Thank you",
      elements: [{ role: "heading", text: "Order confirmed — thank you" }],
    },
  ],
};

const run = (app: MockAppSpec) =>
  new EveSession({
    adapter: new MockAdapter(app),
    startUrl: "mock:cart",
    persona: "impatient-user",
    goal: "check out and pay",
    goalSuccessSignals: ["thank you"],
    seed: 3,
    maxSteps: 30,
    paceScale: 0,
  }).run();

const baseline = await run(baselineBuild);
const candidate = await run(candidateBuild);

console.log(
  `Baseline : completed=${baseline.goalAchieved} steps=${baseline.usage.steps} score=${baseline.scores.find((s) => s.dimension === "overall")!.value}`,
);
console.log(
  `Candidate: completed=${candidate.goalAchieved} steps=${candidate.usage.steps} score=${candidate.scores.find((s) => s.dimension === "overall")!.value}`,
);

const report = compareExperience(baseline, candidate, { baseline: "v1.0", candidate: "v1.1" });
console.log(`\nVerdict: ${report.verdict.toUpperCase()}`);
console.log(report.summary);
console.log("\nRegressed metrics:");
for (const r of report.regressions) {
  console.log(`  ${r.metric}: ${r.baseline} → ${r.candidate} [${r.severity}]`);
}
