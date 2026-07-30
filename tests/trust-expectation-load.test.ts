import { describe, expect, it } from "vitest";
import { DecisionFatigue, estimateCognitiveLoad } from "../src/cognition/cognitiveLoad.js";
import {
  buildExpectation,
  scoreExpectation,
  ViolationStreak,
} from "../src/cognition/expectation.js";
import type { Percept, PredictionOutcome, VisibleElement } from "../src/core/types.js";
import { TrustModel } from "../src/emotion/trust.js";
import { getPersona } from "../src/personas/index.js";

function percept(elements: Partial<VisibleElement>[], overrides: Partial<Percept> = {}): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "Test",
    viewport: { width: 1000, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: elements.map((e, i) => ({
      id: i,
      role: "text",
      text: "",
      box: { x: 0, y: 0, width: 100, height: 24 },
      interactive: false,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
      ...e,
    })),
    dialogs: [],
    loadingIndicator: false,
    ...overrides,
  };
}

function outcome(o: Partial<PredictionOutcome> = {}): PredictionOutcome {
  return {
    prediction: { description: "d", expectedSignals: [], expectsChange: true, confidence: 0.7 },
    surprise: 0,
    matchedSignals: [],
    missedSignals: [],
    screenChanged: true,
    errorPerceived: false,
    perceivedLatencyMs: 200,
    ...o,
  };
}

describe("trust model", () => {
  it("builds slowly and falls quickly (asymmetry)", () => {
    const t1 = new TrustModel(0.5);
    for (let i = 0; i < 5; i++) t1.update(outcome({ surprise: 0 }), false, true);
    const built = t1.overall();

    const t2 = new TrustModel(0.5);
    t2.update(outcome({ surprise: 0.9, errorPerceived: true }), true, false);
    const damaged = t2.overall();

    expect(built).toBeGreaterThan(0.5);
    expect(damaged).toBeLessThan(0.5);
    // One error moves trust more than one success.
    expect(0.5 - damaged).toBeGreaterThan((built - 0.5) / 4);
  });

  it("perceives security cues from the URL and copy", () => {
    const insecure = new TrustModel(0.6);
    insecure.observeSecurityCues(percept([{ text: "log in" }], { url: "http://x.test/" }));
    const secure = new TrustModel(0.6);
    secure.observeSecurityCues(
      percept([{ text: "Your data is encrypted and secure" }], { url: "https://x.test/" }),
    );
    expect(secure.snapshot().securityPerception).toBeGreaterThan(
      insecure.snapshot().securityPerception,
    );
  });
});

describe("expectation engine", () => {
  it("scores a matching outcome highly", () => {
    const target: VisibleElement = {
      id: 0,
      role: "link",
      text: "Billing",
      box: { x: 0, y: 0, width: 100, height: 30 },
      interactive: true,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
    };
    const exp = buildExpectation(
      {
        description: "go to billing",
        expectedSignals: ["billing"],
        expectsChange: true,
        confidence: 0.8,
      },
      target,
      "click",
    );
    const before = percept([{ text: "Billing" }], { url: "https://x.test/" });
    const after = percept([{ text: "Billing overview", role: "heading" }, { text: "Invoices" }], {
      url: "https://x.test/billing",
      title: "Billing",
    });
    const score = scoreExpectation(exp, before, after, 300);
    expect(score.matchScore).toBeGreaterThan(0.6);
    expect(score.surprise).toBeLessThan(0.4);
  });

  it("flags violations when nothing changes", () => {
    const exp = buildExpectation(
      { description: "submit", expectedSignals: ["success"], expectsChange: true, confidence: 0.8 },
      null,
      "click",
    );
    const before = percept([{ text: "Save" }]);
    const score = scoreExpectation(exp, before, before, 5000);
    expect(score.violations).toContain("visual-change");
    expect(score.surprise).toBeGreaterThan(0.3);
  });

  it("violation streak compounds", () => {
    const streak = new ViolationStreak();
    const bad = {
      matchScore: 0.2,
      surprise: 0.8,
      violationSeverity: 0.8,
      violations: ["outcome"] as const,
      perceivedLatencyMs: 100,
    };
    expect(streak.register(bad as never)).toBe(1);
    expect(streak.register(bad as never)).toBe(2);
    expect(streak.register(bad as never)).toBe(3);
    expect(streak.totalViolations()).toBe(3);
  });
});

describe("cognitive load", () => {
  it("a dense screen has higher load than a simple one", () => {
    const persona = getPersona("office-worker");
    const simple = percept([
      { text: "Welcome", role: "heading" },
      { text: "Start", role: "button", interactive: true },
    ]);
    const dense = percept(
      Array.from({ length: 30 }, (_, i) => ({
        text: `option ${i} with some descriptive text`,
        role: "button" as const,
        interactive: true,
        box: { x: (i % 5) * 200, y: Math.floor(i / 5) * 40, width: 190, height: 34 },
      })),
    );
    const simpleLoad = estimateCognitiveLoad(simple, null, persona);
    const denseLoad = estimateCognitiveLoad(dense, null, persona);
    expect(denseLoad.index).toBeGreaterThan(simpleLoad.index);
    expect(denseLoad.decisionLoad).toBeGreaterThan(simpleLoad.decisionLoad);
  });

  it("decision fatigue accumulates", () => {
    const fatigue = new DecisionFatigue();
    const before = fatigue.level();
    for (let i = 0; i < 20; i++) fatigue.register(80);
    expect(fatigue.level()).toBeGreaterThan(before);
  });
});
