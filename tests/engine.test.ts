import { describe, expect, it } from "vitest";
import { EveSession } from "../src/engine/index.js";
import { MockAdapter, DEMO_APP } from "../src/browser/index.js";
import { AccessibilityPlugin, PerformancePlugin } from "../src/plugins/index.js";
import { buildReport, renderHtml, renderMarkdown, renderJson } from "../src/reporting/index.js";

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
