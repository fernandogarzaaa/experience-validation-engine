/**
 * Regression tests for three quality fixes surfaced by dogfooding EVE on a
 * model of its own (non-e-commerce) console:
 *   1. business-goal / screen-purpose classifiers cover tool/console vocab
 *   2. goal-less studies don't report the step budget as a "too-long path"
 *   3. reports show a supplied label instead of the literal `mock:` url
 */
import { describe, it, expect, beforeAll } from "vitest";

import { EveSession, type SessionResult } from "../src/engine/session.js";
import { MockAdapter, type MockAppSpec } from "../src/browser/index.js";
import { simulatePopulation, type PopulationStudy } from "../src/population/index.js";
import { inferProductIntelligence, renderProductIntelligenceMarkdown } from "../src/product/index.js";
import { predictUX } from "../src/predict/index.js";
import { renderStudyMarkdown } from "../src/research/index.js";
import { buildApplicationMap } from "../src/appmap/index.js";
import { moderateStudy } from "../src/study/index.js";

// A model of EVE's own console — a tool, not an e-commerce funnel.
const EVE_CONSOLE: MockAppSpec = {
  name: "EVE Console",
  start: "landing",
  screens: [
    {
      id: "landing",
      title: "EVE — validate the human experience",
      elements: [
        { role: "heading", text: "Validate your app" },
        { role: "button", text: "Start a study", goto: "newStudy" },
        { role: "link", text: "Read the docs", goto: "docs" },
        { role: "link", text: "View a report", goto: "report" },
      ],
    },
    {
      id: "newStudy",
      title: "New study",
      elements: [
        { role: "heading", text: "Configure your study" },
        { role: "button", text: "Run study", goto: "running" },
        { role: "link", text: "Cancel", goto: "landing" },
      ],
    },
    {
      id: "running",
      title: "Running study",
      elements: [
        { role: "heading", text: "Simulating" },
        { role: "progress", text: "" },
        { role: "button", text: "View report", goto: "report" },
      ],
    },
    {
      id: "report",
      title: "Experience report",
      elements: [
        { role: "heading", text: "Experience report" },
        { role: "link", text: "Home", goto: "landing" },
      ],
    },
    {
      id: "docs",
      title: "Documentation",
      elements: [
        { role: "heading", text: "Documentation" },
        { role: "link", text: "Back", goto: "landing" },
      ],
    },
  ],
};

/**
 * Classify a single screen by running product intelligence over a minimal
 * synthetic study whose heatmap contains only that screen. (`classifyGoal` is
 * internal; this exercises it through the public surface.)
 */
function classifyGoalForTest(screen: string): string | undefined {
  const base = {
    url: "mock:",
    label: "mock:",
    size: 1,
    goal: null,
    successRate: 1,
    dropoffRate: 0,
    endReasonBreakdown: {},
    overallScore: { count: 1, mean: 70, stdDev: 0, min: 70, max: 70, p25: 70, median: 70, p75: 70 },
    confidence: { count: 1, mean: 0.6, stdDev: 0, min: 0.6, max: 0.6, p25: 0.6, median: 0.6, p75: 0.6 },
    frustration: { count: 1, mean: 0.1, stdDev: 0, min: 0.1, max: 0.1, p25: 0.1, median: 0.1, p75: 0.1 },
    trust: { count: 1, mean: 0.6, stdDev: 0, min: 0.6, max: 0.6, p25: 0.6, median: 0.6, p75: 0.6 },
    stepsToComplete: { count: 1, mean: 5, stdDev: 0, min: 5, max: 5, p25: 5, median: 5, p75: 5 },
    completionHistogram: { bins: [], total: 0 },
    navigationHeatmap: [{ screen, visits: 10, operators: 1, reach: 1, dropoffs: 0 }],
    segments: [],
    topFindings: [],
    operators: [],
    generatedAt: new Date().toISOString(),
  } as unknown as PopulationStudy;
  return inferProductIntelligence(base).businessGoals[0]?.goal;
}

describe("dogfooding fixes", () => {
  let study: PopulationStudy;
  let explorers: SessionResult[];
  beforeAll(async () => {
    study = await simulatePopulation({
      url: "mock:",
      label: "EVE Console",
      size: 14,
      seed: 7,
      maxSteps: 25,
      concurrency: 8,
      adapterFactory: () => new MockAdapter(EVE_CONSOLE),
    });
    explorers = [];
    for (const [i, persona] of ["curious-explorer", "power-user"].entries()) {
      explorers.push(
        await new EveSession({
          adapter: new MockAdapter(EVE_CONSOLE),
          startUrl: "mock:",
          persona,
          seed: `7#${i}`,
          maxSteps: 25,
        }).run(),
      );
    }
  }, 120_000);

  it("#3 carries a label and uses it in reports (not the literal mock: url)", () => {
    expect(study.label).toBe("EVE Console");
    // The heading must *replace* the url, not merely mention the label.
    const heading = renderStudyMarkdown(study).split("\n")[0];
    expect(heading).toBe("# EVE usability study — EVE Console");
    expect(heading).not.toContain("mock:");

    // url stays the identity; label is the display name (kept separate).
    const intel = inferProductIntelligence(study);
    expect(intel.url).toBe("mock:");
    expect(intel.label).toBe("EVE Console");
    expect(renderProductIntelligenceMarkdown(intel).split("\n")[0]).toBe(
      "# Product intelligence — EVE Console",
    );

    const prediction = predictUX(study);
    expect(prediction.url).toBe("mock:");
    expect(prediction.label).toBe("EVE Console");
  });

  it("#3 defaults the label to the url when none is given", async () => {
    const s = await simulatePopulation({ url: "mock:", size: 4, seed: 1, maxSteps: 15, concurrency: 4 });
    expect(s.label).toBe("mock:");
  }, 60_000);

  it("#1 classifies tool/console screens into meaningful business goals", () => {
    const goals = inferProductIntelligence(study).businessGoals.map((g) => g.goal);
    // Previously only "Account configuration" matched. Assert each expected
    // category explicitly so an overlapping first-match rule fails the test
    // (e.g. `newStudy` must be Configuration & setup, not Task execution).
    expect(goals).toContain("Reporting & analytics");
    expect(goals).toContain("Task execution");
    expect(goals).toContain("Help & documentation");
    expect(goals).toContain("Configuration & setup");
    expect(goals.length).toBeGreaterThan(1);
  });

  it("#1 keeps generic nouns from hijacking first-match goal rules", () => {
    // "study"/"session" must not read as execution; "search results" is discovery.
    expect(classifyGoalForTest("mock://console/newStudy")).toBe("Configuration & setup");
    expect(classifyGoalForTest("mock://console/search-results")).toBe("Discovery");
    expect(classifyGoalForTest("mock://console/running")).toBe("Task execution");
  });

  it("#1 classifies a standalone 'Run' screen as a task (not just 'running')", async () => {
    const runApp: MockAppSpec = {
      name: "Runner",
      start: "home",
      screens: [
        { id: "home", title: "Runner", elements: [{ role: "button", text: "Go", goto: "run" }] },
        { id: "run", title: "Run study", elements: [{ role: "link", text: "Back", goto: "home" }] },
      ],
    };
    const session = await new EveSession({
      adapter: new MockAdapter(runApp),
      startUrl: "mock:",
      persona: "curious-explorer",
      seed: 3,
      maxSteps: 15,
    }).run();
    const map = buildApplicationMap([session]);
    expect(map.screens.find((s) => s.id.endsWith("run"))?.purpose).toBe("Task / run");
  }, 60_000);

  it("#1 infers screen purposes for a tool (docs is not an 'editor')", () => {
    const map = buildApplicationMap(explorers);
    const purpose = (id: string) =>
      map.screens.find((s) => s.id.endsWith(id))?.purpose ?? "";
    expect(purpose("docs")).toBe("Help / docs");
    expect(purpose("report")).toBe("Reporting / results");
    expect(purpose("running")).toBe("Task / run");
    expect(purpose("newStudy")).toBe("Configuration / setup");
  });

  it("#2 does not flag a 'too-long path' for a goal-less study", () => {
    // The console study sets no goal, so completers just hit the step budget.
    const panel = moderateStudy(study);
    const designer = panel.specialists.find((s) => s.role === "Interaction Designer")!;
    expect(designer.observations.some((o) => /explored a median/i.test(o.statement) && o.severity === "info")).toBe(true);
    expect(designer.recommendations.some((r) => /Shorten the primary path/i.test(r.action))).toBe(false);
    expect(designer.observations.some((o) => /happy path is too long|took a median/i.test(o.statement))).toBe(false);
  });
});
