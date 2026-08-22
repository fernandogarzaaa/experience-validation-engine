import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { EveSession } from "../src/engine/index.js";
import { AccessibilityPlugin, PerformancePlugin } from "../src/plugins/index.js";
import { buildReport, renderHtml, renderJson, renderMarkdown } from "../src/reporting/index.js";

describe("end-to-end simulation on the mock app", () => {
  it("runs a full session and produces scores, findings and a timeline", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 42,
      maxSteps: 25,
      paceScale: 0,
      plugins: [new AccessibilityPlugin(), new PerformancePlugin()],
    });
    const result = await session.run();

    expect(result.iterations.length).toBeGreaterThan(5);
    expect(result.emotionTimeline.length).toBeGreaterThan(0);
    expect(result.scores.find((s) => s.dimension === "overall")).toBeDefined();
    for (const score of result.scores) {
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
      expect(score.evidence.length).toBeGreaterThan(0);
    }
    // The explorer should discover at least a couple of workflows.
    expect(result.workflowNodes.length).toBeGreaterThan(2);
    expect(result.appTheory.length).toBeGreaterThan(0);
  }, 30_000);

  it("is reproducible: same seed, same path", async () => {
    const run = async () => {
      const session = new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:landing",
        persona: "office-worker",
        seed: 1234,
        maxSteps: 12,
        paceScale: 0,
      });
      const result = await session.run();
      return result.iterations.map((it) => it.actionDescription);
    };
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toEqual(b);
  }, 30_000);

  it("different seeds explore differently", async () => {
    const run = async (seed: number) => {
      const session = new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:landing",
        persona: "curious-explorer",
        seed,
        maxSteps: 15,
        paceScale: 0,
      });
      const result = await session.run();
      return result.iterations.map((it) => it.actionDescription).join("|");
    };
    const paths = await Promise.all([run(1), run(2), run(3)]);
    expect(new Set(paths).size).toBeGreaterThan(1);
  }, 30_000);

  it("pursues a goal and detects success signals", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:login",
      persona: "office-worker",
      goal: "reset my forgotten password",
      goalSuccessSignals: ["check your email"],
      seed: 7,
      maxSteps: 30,
      paceScale: 0,
    });
    const result = await session.run();
    expect(result.goalAchieved).toBe(true);
    expect(result.endReason).toBe("goal-achieved");
  }, 30_000);

  /*
   * Goal success is decided by substring presence in visible screen text,
   * which is a proxy for task state rather than a measurement of it. These
   * cover the two ways that proxy was found to mislead.
   *
   * A purpose-built three-screen app rather than DEMO_APP: each assertion
   * depends on exactly which text is on which screen and whether it belongs
   * to an interactive control, and pinning that down beats depending on how a
   * persona happens to navigate a larger app.
   */
  const SIGNAL_APP = {
    name: "Signal Fixture",
    start: "home",
    screens: [
      {
        id: "home",
        title: "Widget Factory",
        elements: [
          { role: "heading" as const, text: "Widget Factory" },
          { role: "button" as const, text: "Continue", goto: "notes" },
        ],
      },
      {
        id: "notes",
        title: "Your notes",
        elements: [
          { role: "heading" as const, text: "Your notes" },
          { role: "button" as const, text: "Export all", goto: "done" },
        ],
      },
      {
        id: "done",
        title: "Done",
        elements: [{ role: "heading" as const, text: "Download ready" }],
      },
    ],
  };

  const runSignalSession = async (signals: string[]) => {
    const session = new EveSession({
      adapter: new MockAdapter(SIGNAL_APP),
      startUrl: "mock:home",
      persona: "office-worker",
      goal: "export the notes",
      goalSuccessSignals: signals,
      seed: 11,
      maxSteps: 20,
      paceScale: 0,
    });
    return session.run();
  };

  it("refuses success signals already satisfied by the starting screen", async () => {
    // "widget" is the product's own name, visible before the operator acts.
    // Previously this ended the session at once with goal-achieved and zero
    // interactions.
    const result = await runSignalSession(["widget"]);

    expect(result.goalAchieved).toBe(false);
    expect(result.endReason).not.toBe("goal-achieved");
    expect(result.goalSignalWarnings.join(" ")).toContain(
      "already satisfied by the starting screen",
    );
  }, 30_000);

  it("retires such a signal for the whole session, not just the first step", async () => {
    // The text is still on screen a step later, so deferring rather than
    // retiring would just move the same false success one perception along.
    const result = await runSignalSession(["widget"]);

    expect(result.usage.steps).toBeGreaterThan(1);
    expect(result.goalAchieved).toBe(false);
  }, 30_000);

  it("still accepts a signal that only appears once the task is done", async () => {
    const result = await runSignalSession(["download ready"]);

    expect(result.goalAchieved).toBe(true);
    expect(result.endReason).toBe("goal-achieved");
    // Reached as a heading on the final screen, so nothing to warn about.
    expect(result.goalSignalWarnings).toEqual([]);
  }, 30_000);

  it("warns when a signal is carried only by an interactive control's label", async () => {
    // "Export all" is a button on the notes screen. Arriving there satisfies
    // the signal without the export ever being performed. Reported rather
    // than refused: a label can legitimately be the only wording of a
    // completed state, and only the author can tell the two apart.
    const result = await runSignalSession(["export all"]);

    expect(result.goalAchieved).toBe(true);
    expect(result.goalSignalWarnings.join(" ")).toContain(
      "only by the label of an interactive element",
    );
  }, 30_000);

  it("emits typed events during the loop", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "student",
      seed: 5,
      maxSteps: 6,
      paceScale: 0,
    });
    const seen: string[] = [];
    session.events.on("session:start", () => void seen.push("start"));
    session.events.on("loop:decide", () => void seen.push("decide"));
    session.events.on("loop:outcome", () => void seen.push("outcome"));
    session.events.on("session:end", () => void seen.push("end"));
    await session.run();
    expect(seen[0]).toBe("start");
    expect(seen).toContain("decide");
    expect(seen).toContain("outcome");
    expect(seen.at(-1)).toBe("end");
  }, 30_000);

  it("keyboard-only personas use keys, not the mouse", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "accessibility-user",
      seed: 3,
      maxSteps: 12,
      paceScale: 0,
    });
    const result = await session.run();
    const presses = result.iterations.filter((it) => it.action.kind === "press").length;
    expect(presses).toBeGreaterThan(0);
  }, 30_000);
});

describe("reporting", () => {
  it("renders all three formats from a real session", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "first-time-user",
      seed: 99,
      maxSteps: 10,
      paceScale: 0,
    });
    const result = await session.run();
    const report = buildReport(result);

    const html = renderHtml(report);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Experience Report");
    expect(html).toContain("Emotional Timeline");

    const md = renderMarkdown(report);
    expect(md).toContain("# Experience Report");
    expect(md).toContain("## Executive Summary");
    expect(md).toContain("Quick Wins");

    const json = JSON.parse(renderJson(report)) as { overallScore: number; findings: unknown[] };
    expect(json.overallScore).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(json.findings)).toBe(true);
  }, 30_000);
});
