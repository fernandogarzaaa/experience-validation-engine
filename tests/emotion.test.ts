import { describe, expect, it } from "vitest";
import type { PredictionOutcome } from "../src/core/types.js";
import { appraise, EmotionalState } from "../src/emotion/index.js";
import { getPersona } from "../src/personas/index.js";

function outcome(overrides: Partial<PredictionOutcome> = {}): PredictionOutcome {
  return {
    prediction: {
      description: "test",
      expectedSignals: ["save"],
      expectsChange: true,
      confidence: 0.8,
    },
    surprise: 0,
    matchedSignals: ["save"],
    missedSignals: [],
    screenChanged: true,
    errorPerceived: false,
    perceivedLatencyMs: 200,
    ...overrides,
  };
}

describe("emotional model", () => {
  it("starts from persona disposition", () => {
    const anxious = new EmotionalState(getPersona("anxious-user"));
    const confident = new EmotionalState(getPersona("confident-user"));
    expect(anxious.get("confidence")).toBeLessThan(confident.get("confidence"));
  });

  it("errors raise frustration and lower trust", () => {
    const persona = getPersona("office-worker");
    const emotion = new EmotionalState(persona);
    const before = emotion.snapshot();
    appraise(emotion, persona, {
      outcome: outcome({ errorPerceived: true, surprise: 0.9 }),
      madeProgress: false,
      novelScreen: false,
      cognitiveEffort: 0.5,
    });
    expect(emotion.get("frustration")).toBeGreaterThan(before.frustration);
    expect(emotion.get("trust")).toBeLessThan(before.trust);
  });

  it("confirmed predictions build confidence", () => {
    const persona = getPersona("office-worker");
    const emotion = new EmotionalState(persona);
    const before = emotion.get("confidence");
    for (let i = 0; i < 5; i++) {
      appraise(emotion, persona, {
        outcome: outcome(),
        madeProgress: true,
        novelScreen: true,
        cognitiveEffort: 0.2,
      });
    }
    expect(emotion.get("confidence")).toBeGreaterThan(before);
  });

  it("dead clicks frustrate impatient personas more", () => {
    const impatient = getPersona("impatient-user");
    const patient = getPersona("elderly-user");
    const e1 = new EmotionalState(impatient);
    const e2 = new EmotionalState(patient);
    const dead = outcome({ screenChanged: false, surprise: 0.85 });
    const ctx = { outcome: dead, madeProgress: false, novelScreen: false, cognitiveEffort: 0.3 };
    const f1 = e1.get("frustration");
    const f2 = e2.get("frustration");
    appraise(e1, impatient, ctx);
    appraise(e2, patient, ctx);
    expect(e1.get("frustration") - f1).toBeGreaterThan(e2.get("frustration") - f2);
  });

  it("fatigue only accumulates, never decays", () => {
    const persona = getPersona("office-worker");
    const emotion = new EmotionalState(persona);
    for (let i = 0; i < 30; i++) {
      appraise(emotion, persona, {
        outcome: outcome(),
        madeProgress: false,
        novelScreen: false,
        cognitiveEffort: 0.8,
      });
      emotion.decay(0.1);
    }
    expect(emotion.get("fatigue")).toBeGreaterThan(0.2);
  });

  it("records a timeline with means and peaks", () => {
    const persona = getPersona("office-worker");
    const emotion = new EmotionalState(persona);
    emotion.record(0, 0);
    emotion.adjust("frustration", 0.5);
    emotion.record(1, 1000);
    expect(emotion.timeline()).toHaveLength(2);
    expect(emotion.peak("frustration")).toBeGreaterThanOrEqual(emotion.mean("frustration"));
  });
});
