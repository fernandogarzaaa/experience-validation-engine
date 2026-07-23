/**
 * Phase 3 — Population simulation.
 *
 * Instead of one operator, run a whole population of varied humans against the
 * same app and aggregate their experiences into a statistical usability study:
 * success/drop-off rates, distributions, a task-completion histogram, a
 * navigation heatmap, expected user segments, and the findings most people hit.
 *
 * Then export the reproducible research dataset (JSON + CSV + Markdown).
 *
 * Run:
 *   npx tsx examples/population-study.ts
 */

import { simulatePopulation } from "../src/population/index.js";
import { renderStudyMarkdown, writeStudyDataset } from "../src/research/index.js";

const study = await simulatePopulation({
  url: "mock:", // offline demo app — swap for a real URL (needs a browser)
  size: 40, // forty simulated humans...
  // ...sampled across the whole persona library (leave `personas` unset), and
  // mixed across professions and cultures for a realistic spread:
  professions: ["accountant", "designer", "executive"],
  cultures: ["en-US", "de-DE", "ja-JP"],
  seed: 7, // reproducible: same seed → same population
  concurrency: 8,
  onProgress: (done, total) => {
    if (done === total || done % 10 === 0) process.stdout.write(`  ${done}/${total} operators\n`);
  },
});

process.stdout.write("\n" + renderStudyMarkdown(study) + "\n");

const written = await writeStudyDataset(study, ".eve-output/study");
process.stdout.write(
  `\nResearch dataset written:\n  ${written.markdown}\n  ${written.csv}\n  ${written.json}\n`,
);

// The CSV is a tidy, one-row-per-operator dataset ready for pandas/R:
//   import pandas as pd; df = pd.read_csv(".eve-output/study/operators.csv")
