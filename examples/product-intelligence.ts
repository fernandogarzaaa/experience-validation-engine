/**
 * Phase 3 — Product intelligence.
 *
 * From how a population actually moved through an app, infer *product* insight
 * (not just UX findings): the personas the population reveals, the business
 * goals its traffic serves, the critical workflows, feature importance,
 * high-friction pages, and the causes of drop-off.
 *
 * Run:
 *   npx tsx examples/product-intelligence.ts
 */

import { simulatePopulation } from "../src/population/index.js";
import {
  inferProductIntelligence,
  renderProductIntelligenceMarkdown,
} from "../src/product/index.js";

const study = await simulatePopulation({ url: "mock:", size: 30, seed: 7, concurrency: 8 });
const intel = inferProductIntelligence(study);

process.stdout.write(`${renderProductIntelligenceMarkdown(intel)}\n`);

process.stdout.write(`\nTop business goal by traffic: ${intel.businessGoals[0]?.goal ?? "—"}\n`);
process.stdout.write(`Critical path: ${intel.criticalWorkflows[0]?.sequence.join(" → ") ?? "—"}\n`);
