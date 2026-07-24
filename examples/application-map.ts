/**
 * Phase 3 — Autonomous exploration → application map.
 *
 * Given only a URL, let several curious operators explore the app with no
 * predefined workflows, then reconstruct a complete application map from what
 * they perceived: screens and their inferred purpose, the navigation graph (as
 * a Mermaid diagram), information architecture, hubs, dead-ends, and the
 * affordances nobody got to exercise.
 *
 * Run:
 *   npx tsx examples/application-map.ts
 */

import { EveSession, type SessionResult } from "../src/engine/session.js";
import { MockAdapter, DEMO_APP } from "../src/browser/index.js";
import { buildApplicationMap, renderApplicationMapMarkdown } from "../src/appmap/index.js";

const explorers = ["curious-explorer", "power-user", "first-time-user"];
const results: SessionResult[] = [];
for (const [i, persona] of explorers.entries()) {
  results.push(
    await new EveSession({
      adapter: new MockAdapter(DEMO_APP), // swap for a real adapter + URL
      startUrl: "mock:",
      persona,
      seed: `7#${i}`,
      maxSteps: 50,
    }).run(),
  );
}

const map = buildApplicationMap(results);
process.stdout.write(renderApplicationMapMarkdown(map) + "\n");
process.stdout.write(
  `\nDiscovered ${map.coverage.screens} screens and ${map.coverage.transitions} transitions ` +
    `from ${explorers.length} explorers — no predefined workflows.\n`,
);
