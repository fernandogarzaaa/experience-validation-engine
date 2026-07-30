import { describe, expect, it } from "vitest";
import { hesitationMs, planClick, planTyping } from "../src/browser/index.js";
import { createRng } from "../src/core/random.js";
import type { VisibleElement } from "../src/core/types.js";
import { getPersona } from "../src/personas/index.js";

const target: VisibleElement = {
  id: 0,
  role: "button",
  text: "Save",
  box: { x: 100, y: 100, width: 120, height: 40 },
  interactive: true,
  disabled: false,
  editable: false,
  focused: false,
  clippedByViewport: false,
};

describe("humanizer", () => {
  it("click points land in or near the target and time is positive", () => {
    const rng = createRng(11);
    const persona = getPersona("office-worker");
    for (let i = 0; i < 50; i++) {
      const gesture = planClick(target, persona, rng);
      expect(gesture.durationMs).toBeGreaterThan(0);
      // After miss-correction, the executed point is always inside the box.
      expect(gesture.point.x).toBeGreaterThanOrEqual(target.box.x);
      expect(gesture.point.x).toBeLessThanOrEqual(target.box.x + target.box.width);
    }
  });

  it("low-accuracy personas miss small targets sometimes", () => {
    const rng = createRng(2);
    const elderly = getPersona("elderly-user");
    const tiny: VisibleElement = { ...target, box: { x: 100, y: 100, width: 18, height: 14 } };
    let misses = 0;
    for (let i = 0; i < 200; i++) {
      if (planClick(tiny, elderly, rng).missed) misses += 1;
    }
    expect(misses).toBeGreaterThan(0);
  });

  it("typing plans include occasional corrected typos", () => {
    const rng = createRng(3);
    const persona = getPersona("impatient-user");
    const text = "the quick brown fox jumps over the lazy dog ".repeat(6);
    const plan = planTyping(text, persona, rng);
    expect(plan.keystrokes.length).toBeGreaterThanOrEqual(text.length);
    expect(plan.totalMs).toBeGreaterThan(0);
    // With ~250 chars and a few % typo rate, at least one typo is expected.
    expect(plan.typoCount).toBeGreaterThan(0);
    // Every typo contributes neighborKey + backspace + correction.
    expect(plan.keystrokes.filter((k) => k === "\b")).toHaveLength(plan.typoCount);
  });

  it("risky actions cause hesitation scaled by risk tolerance", () => {
    const rng1 = createRng(4);
    const rng2 = createRng(4);
    const anxious = getPersona("anxious-user");
    const confident = getPersona("confident-user");
    expect(hesitationMs(1, anxious, rng1)).toBeGreaterThan(hesitationMs(1, confident, rng2));
    expect(hesitationMs(0, anxious, rng1)).toBe(0);
  });
});
