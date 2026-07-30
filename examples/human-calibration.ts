/**
 * Phase 3 — Human validation engine (calibration).
 *
 * Import anonymized human usability traces and score how closely EVE's
 * simulated population matches real humans — a Similarity Score plus behavior,
 * navigation, and timing similarity, a friction-location correlation, and
 * frustration/confidence alignment. Low dimensions show where to tune EVE next.
 *
 * Run:
 *   npx tsx examples/human-calibration.ts
 */

import { type HumanStudy, calibrate, renderCalibrationMarkdown } from "../src/calibration/index.js";
import { simulatePopulation } from "../src/population/index.js";

// In practice you'd load these traces from your own (anonymized) usability
// study — see docs/human-calibration.md for the JSON schema. Here we hand-write
// a small study for the mock app.
const humanStudy: HumanStudy = {
  task: "explore the app",
  traces: [
    {
      completed: true,
      path: ["mock://acme-notes/dashboard", "mock://acme-notes/editor"],
      steps: 8,
      frustration: 0.2,
      confidence: 0.7,
    },
    {
      completed: true,
      path: ["mock://acme-notes/dashboard", "mock://acme-notes/settings"],
      steps: 12,
      frustration: 0.3,
      confidence: 0.6,
    },
    {
      completed: false,
      path: ["mock://acme-notes/dashboard", "mock://acme-notes/settings"],
      steps: 20,
      frustration: 0.7,
      confidence: 0.3,
      abandonedOn: "mock://acme-notes/settings",
    },
    {
      completed: true,
      path: ["mock://acme-notes/dashboard", "mock://acme-notes/export"],
      steps: 10,
      frustration: 0.25,
      confidence: 0.65,
    },
  ],
};

const study = await simulatePopulation({ url: "mock:", size: 30, seed: 7, concurrency: 8 });
const report = calibrate(humanStudy, study);

process.stdout.write(`${renderCalibrationMarkdown(report)}\n`);
