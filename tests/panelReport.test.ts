import { describe, expect, it } from "vitest";

import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { EveSession } from "../src/engine/session.js";
import type { DevTicket } from "../src/panel/developer.js";
import { toMarkdownTasks } from "../src/panel/developer.js";
import { runPanel } from "../src/panel/index.js";
import { renderPanelMarkdown } from "../src/reporting/panelReport.js";

function ticket(overrides: Partial<DevTicket> = {}): DevTicket {
  return {
    key: "US-1",
    title: "Fix the confusing checkout button",
    body: "**User story:** As a shopper, I want a clear checkout button, so that I can complete my purchase.",
    labels: ["ux", "eve-generated", "severity:major"],
    priority: "high",
    estimate: "M",
    acceptanceCriteria: ['The button reads "Checkout"', "The button is above the fold"],
    ...overrides,
  };
}

describe("toMarkdownTasks", () => {
  it("renders an empty backlog as a title with no task sections", () => {
    const doc = toMarkdownTasks([]);
    expect(doc).toBe("# EVE-generated UX backlog\n");
  });

  it("accepts a custom title", () => {
    const doc = toMarkdownTasks([], "My Custom Backlog");
    expect(doc.split("\n")[0]).toBe("# My Custom Backlog");
  });

  it("renders one section per ticket with key, title, priority and body", () => {
    const doc = toMarkdownTasks([ticket()]);

    expect(doc).toContain("## US-1 — Fix the confusing checkout button");
    expect(doc).toContain("Priority: **high**");
    expect(doc).toContain("Estimate: **M**");
    expect(doc).toContain("Labels: ux, eve-generated, severity:major");
    expect(doc).toContain("As a shopper, I want a clear checkout button");
  });

  it("preserves ticket order and renders every ticket", () => {
    const doc = toMarkdownTasks([
      ticket({ key: "US-1", title: "First" }),
      ticket({ key: "US-2", title: "Second" }),
    ]);

    const firstIndex = doc.indexOf("## US-1 — First");
    const secondIndex = doc.indexOf("## US-2 — Second");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });
});

describe("renderPanelMarkdown", () => {
  async function buildPanel() {
    const sessions = await Promise.all(
      ["first-time-user", "impatient-user"].map((persona) =>
        new EveSession({
          adapter: new MockAdapter(DEMO_APP),
          startUrl: "mock:landing",
          persona,
          goal: "create an account",
          goalSuccessSignals: ["your notes"],
          seed: 3,
          maxSteps: 15,
          paceScale: 0,
        }).run(),
      ),
    );
    return runPanel(sessions);
  }

  it("renders every top-level section with real panel data", async () => {
    const panel = await buildPanel();
    const doc = renderPanelMarkdown(panel);

    expect(doc).toContain("# EVE Panel — Executive Experience Report");
    expect(doc).toContain("## Executive Summary");
    expect(doc).toContain("## Top Priorities");
    expect(doc).toContain("## Consensus Issues (multiple personas agreed)");
    expect(doc).toContain("## Design Critic (independent heuristic inspection)");
    expect(doc).toContain("## Experience Forecast");
    expect(doc).toContain("## Product Plan");
    expect(doc).toContain("## Developer Backlog");

    expect(doc).toContain(`${panel.executive.personaCount} persona(s)`);
    expect(doc).toContain(`${panel.critique.inspectionScore}/100`);
    expect(doc).toContain(`${panel.tickets.length} ticket(s) generated`);
    expect(doc).toContain(panel.plan.northStar);
  }, 30_000);

  it("falls back to placeholder copy when there are no priorities or disagreements", async () => {
    const panel = await buildPanel();
    const doc = renderPanelMarkdown({
      ...panel,
      executive: { ...panel.executive, topPriorities: [], consensusIssues: [], disagreements: [] },
    });

    expect(doc).toContain("_No high-priority issues — the experience is solid across personas._");
    expect(doc).toContain("_No consensus issues._");
    expect(doc).not.toContain("## Disagreements Between Personas");
  }, 30_000);

  it("embeds the developer backlog's markdown task list", async () => {
    const panel = await buildPanel();
    const doc = renderPanelMarkdown(panel);
    const expectedTasks = toMarkdownTasks(panel.tickets).split("\n").slice(1).join("\n");

    expect(doc).toContain(expectedTasks.trim());
  }, 30_000);
});
