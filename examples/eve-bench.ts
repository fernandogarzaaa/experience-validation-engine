/**
 * Phase 3 — EVE Bench (the benchmark platform).
 *
 * Run the formal EVE Bench suite: known-quality reference apps put through the
 * full cognitive simulation, producing a multi-dimensional scorecard per case
 * (task success, overall experience, frustration, trust, cognitive load,
 * expectation alignment, learnability) plus an overall score and a
 * construct-validity check.
 *
 * Run:
 *   npx tsx examples/eve-bench.ts
 */

import { runEveBench, renderEveBenchMarkdown } from "../src/evebench/index.js";

const report = await runEveBench({ seed: 7, maxSteps: 40 });

process.stdout.write(renderEveBenchMarkdown(report) + "\n");
process.exit(report.ordered ? 0 : 1); // CI gate: fail if the instrument miscalibrates
