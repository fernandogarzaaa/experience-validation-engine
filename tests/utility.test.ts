import { describe, expect, it } from "vitest";
import {
  decisionWeights,
  evaluateUtilities,
  softmaxChoice,
  motorEffort,
  wantsVerification,
} from "../src/cognition/utility.js";
import { getPersona } from "../src/personas/index.js";
import type { EmotionVector } from "../src/emotion/emotionalState.js";
import type { SalienceScore } from "../src/cognition/salience.js";
import type { VisibleElement } from "../src/core/types.js";

function emotion(overrides: Partial<EmotionVector> = {}): EmotionVector {
  return {
    confidence: 0.5,
    frustration: 0.1,
    trust: 0.6,
    confusion: 0.1,
    curiosity: 0.5,
    fatigue: 0.1,
    satisfaction: 0.5,
    interest: 0.5,
    stress: 0.1,
    ...overrides,
  };
}

function el(text: string, box = { x: 10, y: 10, width: 120, height: 40 }): VisibleElement {
  return {
    id: 0,
    role: "button",
    text,
    box,
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
  };
}

function score(overrides: Partial<SalienceScore>): SalienceScore {
  return {
    element: el("Button"),
    total: 1,
    goalRelevance: 0.5,
    prominence: 0.5,
    novelty: 1,
    risk: 0,
    ...overrides,
  };
}

describe("decision weights respond to emotion", () => {
  it("frustration collapses curiosity and raises urgency", () => {
    const calm = decisionWeights(getPersona("office-worker"), emotion());
    const frustrated = decisionWeights(getPersona("office-worker"), emotion({ frustration: 0.9 }));
    expect(frustrated.curiosity).toBeLessThan(calm.curiosity);
    expect(frustrated.urgency).toBeGreaterThan(calm.urgency);
  });

  it("low trust and low confidence raise risk aversion", () => {
    const trusting = decisionWeights(getPersona("office-worker"), emotion({ trust: 0.9, confidence: 0.9 }));
    const wary = decisionWeights(getPersona("office-worker"), emotion({ trust: 0.2, confidence: 0.2 }));
    expect(wary.risk).toBeGreaterThan(trusting.risk);
  });

  it("fatigue raises effort aversion", () => {
    const fresh = decisionWeights(getPersona("office-worker"), emotion({ fatigue: 0 }));
    const tired = decisionWeights(getPersona("office-worker"), emotion({ fatigue: 0.9 }));
    expect(tired.effort).toBeGreaterThan(fresh.effort);
  });
});

describe("utility evaluation", () => {
  it("prefers high-reward low-risk actions", () => {
    const weights = decisionWeights(getPersona("office-worker"), emotion());
    const candidates = [
      score({ element: el("Good"), goalRelevance: 0.9, risk: 0 }),
      score({ element: el("Risky"), goalRelevance: 0.9, risk: 1 }),
    ];
    const utils = evaluateUtilities(candidates, weights);
    expect(utils[0]!.element.text).toBe("Good");
    expect(utils[0]!.utility).toBeGreaterThan(utils[1]!.utility);
  });

  it("motor effort grows with distance and shrinks with size (Fitts)", () => {
    const near = motorEffort(el("x", { x: 100, y: 100, width: 200, height: 60 }), { x: 110, y: 110 });
    const far = motorEffort(el("x", { x: 900, y: 700, width: 20, height: 12 }), { x: 0, y: 0 });
    expect(far).toBeGreaterThan(near);
  });
});

describe("softmax choice", () => {
  it("is reproducible under a fixed sampler and favors top utility", () => {
    const weights = decisionWeights(getPersona("office-worker"), emotion());
    const candidates = evaluateUtilities(
      [score({ element: el("Best"), goalRelevance: 1, risk: 0 }), score({ element: el("Meh"), goalRelevance: 0.1 })],
      weights,
    );
    // Deterministic sampler at 0 always picks the first (highest) bucket.
    const chosen = softmaxChoice(candidates, weights, () => 0);
    expect(chosen.element.text).toBe("Best");
  });
});

describe("verification behavior", () => {
  it("low trust induces double-checking of risky actions", () => {
    expect(wantsVerification(0.8, emotion({ trust: 0.15 }), getPersona("anxious-user"))).toBe(true);
    expect(wantsVerification(0.8, emotion({ trust: 0.95 }), getPersona("confident-user"))).toBe(false);
    expect(wantsVerification(0.1, emotion({ trust: 0.1 }), getPersona("anxious-user"))).toBe(false);
  });
});
