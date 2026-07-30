/**
 * The AI panel: run a panel of personas, then have a team of AIs synthesize
 * the results — an independent design critic, an experience forecaster, a
 * moderator finding consensus, a product manager building a backlog, and a
 * developer turning it into tickets.
 *
 *   npx tsx examples/ai-panel.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { EveSession, MockAdapter } from "../src/index.js";
import { BENCHMARK_APPS } from "../src/index.js";
import { renderPanelMarkdown, runPanel } from "../src/index.js";
import { toGitHubIssues } from "../src/index.js";

const personas = ["first-time-user", "impatient-user", "office-worker", "anxious-user"];

const sessions = [];
for (const persona of personas) {
  const session = new EveSession({
    adapter: new MockAdapter(BENCHMARK_APPS.bad), // a deliberately rough app
    startUrl: "mock:home",
    persona,
    goal: "create an account and reach the main screen",
    goalSuccessSignals: ["has been created"],
    seed: 100,
    maxSteps: 40,
    paceScale: 0,
  });
  sessions.push(await session.run());
}

const panel = runPanel(sessions);

console.log(panel.executive.executiveSummary);
console.log(`\nConsensus issues: ${panel.executive.consensusIssues.length}`);
console.log(`Design critic score: ${panel.critique.inspectionScore}/100`);
console.log(`Forecast: ${panel.forecast.summary}`);
console.log(`\nProduct backlog (${panel.plan.epics.length} epics):`);
for (const epic of panel.plan.epics.slice(0, 5)) {
  console.log(
    `  [${epic.priorityScore}] ${epic.title} — +${Math.round(epic.estimatedCompletionLift * 100)}% est.`,
  );
}

await mkdir(".eve-output", { recursive: true });
await writeFile(".eve-output/panel-report.md", renderPanelMarkdown(panel), "utf8");
await writeFile(
  ".eve-output/github-issues.json",
  JSON.stringify(toGitHubIssues(panel.tickets), null, 2),
  "utf8",
);
console.log(`\n${panel.tickets.length} developer tickets → .eve-output/github-issues.json`);
console.log("Full executive report → .eve-output/panel-report.md");
