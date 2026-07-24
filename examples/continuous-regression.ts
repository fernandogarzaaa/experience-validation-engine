/**
 * Phase 3 — Continuous UX regression.
 *
 * Track experience across a series of builds and detect where it improves or
 * regresses — even when functional tests stay green. Here we simulate three
 * builds of increasing quality (bad → average → excellent) and watch the trend.
 *
 * Run:
 *   npx tsx examples/continuous-regression.ts
 */

import { simulatePopulation } from "../src/population/index.js";
import { analyzeTrends, renderTrendReportMarkdown } from "../src/trends/index.js";
import { BAD_APP, AVERAGE_APP, EXCELLENT_APP } from "../src/benchmarks/index.js";
import { MockAdapter } from "../src/browser/index.js";

const common = {
  url: "mock:home",
  size: 12,
  seed: 5,
  goal: "create an account and get to the main screen",
} as const;

// In a real pipeline each build would be a different deployed URL; here we use
// the three known-quality reference apps as stand-in builds.
const builds = [
  { label: "v1.0 (bad)", app: BAD_APP, signal: "has been created" },
  { label: "v1.1 (average)", app: AVERAGE_APP, signal: "your dashboard" },
  { label: "v1.2 (excellent)", app: EXCELLENT_APP, signal: "all set" },
];

const studied = [];
for (const b of builds) {
  const study = await simulatePopulation({
    ...common,
    goalSuccessSignals: [b.signal],
    adapterFactory: () => new MockAdapter(b.app),
  });
  studied.push({ label: b.label, study });
}

const report = analyzeTrends(studied);
process.stdout.write(renderTrendReportMarkdown(report) + "\n");
