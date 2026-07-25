/**
 * EVE on EVE — dogfooding the engine against a model of its own console.
 *
 * EVE has no web UI of its own (it is a CLI / library / MCP server), so it
 * cannot literally look at its own screen. Instead this models EVE's *workflow*
 * as a mock web app — landing → personas → docs → configure → running → report
 * → settings — and runs the whole Phase-3 pipeline over it.
 *
 * IMPORTANT — read the results honestly: the friction below (icon-only
 * controls, export buttons with no visible response, a dense config screen) is
 * deliberately authored into this mock so the run has something real to find.
 * The findings describe *this model*, not a verdict on EVE's actual codebase.
 * What the exercise genuinely validates is EVE's analysis layer working on a
 * tool/console — an app shape well outside the usual e-commerce funnel.
 *
 * See docs/dogfooding.md for what this practice caught.
 *
 * Run:
 *   npx tsx examples/eve-on-eve.ts
 */

import { EveSession, type SessionResult } from "../src/engine/session.js";
import { MockAdapter, type MockAppSpec } from "../src/browser/index.js";
import { simulatePopulation } from "../src/population/index.js";
import { moderateStudy, renderModeratedStudyMarkdown } from "../src/study/index.js";
import { inferProductIntelligence, renderProductIntelligenceMarkdown } from "../src/product/index.js";
import { buildApplicationMap, renderApplicationMapMarkdown } from "../src/appmap/index.js";
import { predictUX, renderUXPredictionMarkdown } from "../src/predict/index.js";
import { analyzeMultimodal, renderMultimodalMarkdown } from "../src/multimodal/index.js";

/** A model of EVE's console surface, with deliberate (authored) friction. */
const EVE_CONSOLE: MockAppSpec = {
  name: "EVE Console",
  start: "landing",
  screens: [
    {
      id: "landing",
      title: "EVE — AI that experiences software like a human",
      elements: [
        { role: "heading", text: "Validate the human experience of your app" },
        { role: "text", text: "Simulate realistic users and get an evidence-backed report." },
        { role: "button", text: "Start a usability study", goto: "newStudy" },
        { role: "link", text: "Browse personas", goto: "personas" },
        { role: "link", text: "Read the docs", goto: "docs" },
        { role: "button", text: "", goto: "settings" }, // icon-only gear (unlabeled)
      ],
    },
    {
      id: "personas",
      title: "Personas — EVE Console",
      elements: [
        { role: "heading", text: "Built-in personas" },
        { role: "listitem", text: "first-time-user — onboarding" },
        { role: "listitem", text: "impatient-user — performance & friction" },
        { role: "listitem", text: "power-user — expert efficiency" },
        { role: "button", text: "Use this persona", goto: "newStudy" },
        { role: "link", text: "Back", goto: "landing" },
      ],
    },
    {
      id: "docs",
      title: "Documentation — EVE Console",
      elements: [
        { role: "heading", text: "Documentation" },
        { role: "text", text: "Population studies, moderated studies, product intelligence." },
        { role: "link", text: "Back to home", goto: "landing" },
      ],
    },
    {
      id: "newStudy",
      title: "New usability study — EVE Console",
      elements: [
        { role: "heading", text: "Configure your study" },
        { role: "textbox", text: "Target URL", editable: true },
        { role: "textbox", text: "Goal (optional)", editable: true },
        { role: "select", text: "Persona" },
        { role: "select", text: "Culture" },
        { role: "checkbox", text: "Enhanced cognition" },
        { role: "checkbox", text: "Persistent memory" },
        { role: "text", text: "Population size, seed, concurrency, max steps…" }, // dense
        { role: "button", text: "Run study", goto: "running" },
        { role: "link", text: "Cancel", goto: "landing" },
      ],
    },
    {
      id: "running",
      title: "Running study… — EVE Console",
      elements: [
        { role: "heading", text: "Simulating operators" },
        { role: "progress", text: "" },
        { role: "button", text: "View report", goto: "report" },
      ],
    },
    {
      id: "report",
      title: "Experience report — EVE Console",
      elements: [
        { role: "heading", text: "Experience report" },
        { role: "text", text: "Overall 67/100 · success 72% · segments, heatmap, journal…" },
        { role: "alert", text: "Report generated successfully" }, // toast
        { role: "button", text: "Export JSON" }, // no goto → no visible response
        { role: "button", text: "Export CSV" }, // no goto → no visible response
        { role: "link", text: "Run another study", goto: "newStudy" },
      ],
    },
    {
      id: "settings",
      title: "Settings — EVE Console",
      elements: [
        { role: "heading", text: "Settings" },
        { role: "text", text: "MCP server, API keys, output directory." },
        { role: "button", text: "Save changes" }, // no goto → no visible response
        { role: "link", text: "Back", goto: "landing" },
      ],
    },
  ],
};

const SEED = 7;
const rule = "=".repeat(72);

// A population of varied operators over the console model. `label` keeps the
// reports readable — the adapter serves the console, not the literal `mock:`.
const study = await simulatePopulation({
  url: "mock:",
  label: "EVE Console",
  size: 30,
  seed: SEED,
  concurrency: 8,
  adapterFactory: () => new MockAdapter(EVE_CONSOLE),
});

// A few curious explorers for the application map.
const explorers: SessionResult[] = [];
for (const [i, persona] of ["curious-explorer", "power-user", "first-time-user"].entries()) {
  explorers.push(
    await new EveSession({
      adapter: new MockAdapter(EVE_CONSOLE),
      startUrl: "mock:",
      persona,
      seed: `${SEED}#map${i}`,
      maxSteps: 50,
    }).run(),
  );
}

process.stdout.write(`\n${rule}\nEVE-on-EVE — the EVE Console, experienced by EVE\n${rule}\n\n`);
process.stdout.write(renderModeratedStudyMarkdown(moderateStudy(study)));
process.stdout.write(`\n${rule}\n\n` + renderProductIntelligenceMarkdown(inferProductIntelligence(study)));
process.stdout.write(`\n${rule}\n\n` + renderUXPredictionMarkdown(predictUX(study)));
process.stdout.write(`\n${rule}\n\n` + renderApplicationMapMarkdown(buildApplicationMap(explorers)));
process.stdout.write(`\n${rule}\n\n` + renderMultimodalMarkdown(analyzeMultimodal(explorers[0]!)));
