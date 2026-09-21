import { describe, expect, it } from "vitest";
import {
  CLICK_MISCLICK_POLICY,
  planClick,
  planSoftKeyType,
  planTap,
  planTyping,
  TAP_MISCLICK_POLICY,
} from "../src/browser/index.js";
import { createRng } from "../src/core/random.js";
import type { VisibleElement } from "../src/core/types.js";
import { definePersona } from "../src/personas/index.js";

function target(width: number, height: number): VisibleElement {
  return {
    id: 0,
    role: "button",
    text: "Save",
    box: { x: 100, y: 100, width, height },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
  };
}

const VIEWPORT = { width: 1280, height: 800 };

describe("misclick semantics (P1.1)", () => {
  it("is deterministic: same seed → same disposition and point", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.1 } });
    const a = planClick(target(8, 8), persona, createRng(5));
    const b = planClick(target(8, 8), persona, createRng(5));
    expect(a).toEqual(b);
  });

  it("hits land on target with disposition hit", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.99 } });
    for (let seed = 0; seed < 20; seed++) {
      const g = planClick(target(200, 60), persona, createRng(seed));
      expect(g.disposition).toBe("hit");
      expect(g.missed).toBe(false);
    }
  });

  it("produces corrected misses that re-center with a time cost", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.3 } });
    let found = false;
    for (let seed = 0; seed < 500 && !found; seed++) {
      const g = planClick(target(10, 10), persona, createRng(seed));
      if (g.disposition === "corrected") {
        found = true;
        expect(g.missed).toBe(true);
        expect(g.point).toEqual({ x: 105, y: 105 });
      }
    }
    expect(found).toBe(true);
  });

  it("produces true stray misses that land off-target", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.05 } });
    let found = false;
    for (let seed = 0; seed < 2000 && !found; seed++) {
      const g = planClick(target(6, 6), persona, createRng(seed));
      if (g.disposition === "stray") {
        found = true;
        expect(g.missed).toBe(true);
        const { box } = target(6, 6);
        const inside =
          g.point.x >= box.x &&
          g.point.x <= box.x + box.width &&
          g.point.y >= box.y &&
          g.point.y <= box.y + box.height;
        expect(inside).toBe(false);
      }
    }
    expect(found).toBe(true);
  });

  it("taps distinguish touch dispositions identically", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.2 } });
    const kinds = new Set(
      Array.from(
        { length: 200 },
        (_, s) => planTap(target(10, 10), persona, createRng(s), VIEWPORT).disposition,
      ),
    );
    expect(kinds.has("hit")).toBe(true);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("threshold is a parameter: zero threshold strays every miss (reviewer decision 5)", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.3 } });
    // Find a seed that misses under the default policy first.
    let seed = -1;
    for (let s = 0; s < 500; s++) {
      if (planClick(target(10, 10), persona, createRng(s)).missed) {
        seed = s;
        break;
      }
    }
    expect(seed).toBeGreaterThanOrEqual(0);
    const strict = planClick(target(10, 10), persona, createRng(seed), {
      nearMissThresholdPx: 0,
      scatterMultiple: 0,
    });
    expect(strict.missed).toBe(true);
    expect(strict.disposition).toBe("stray");
    const lenient = planClick(target(10, 10), persona, createRng(seed), {
      nearMissThresholdPx: 10_000,
      scatterMultiple: 10_000,
    });
    expect(lenient.disposition).toBe("corrected");
  });

  it("device defaults stay distinct: touch tolerates wider slips than mouse", () => {
    expect(TAP_MISCLICK_POLICY.nearMissThresholdPx).toBeGreaterThan(
      CLICK_MISCLICK_POLICY.nearMissThresholdPx,
    );
  });
});

describe("typing accuracy independence (P1.2)", () => {
  it("perfect pointer precision does not imply perfect typing", () => {
    const persona = definePersona({
      name: "t",
      traits: { clickAccuracy: 1, typingAccuracy: 0 },
    });
    let typos = 0;
    for (let seed = 0; seed < 50; seed++) {
      typos += planTyping("asdfghjklqwerty", persona, createRng(seed)).typoCount;
    }
    expect(typos).toBeGreaterThan(0);
  });

  it("typo rate follows typingAccuracy, not pointer precision", () => {
    // Same typingAccuracy, opposite pointer precision, same seeds: with the
    // old clickAccuracy-coupled formula these would differ; now the streams
    // are identical — decoupling asserted deterministically.
    const shakyHands = definePersona({
      name: "t",
      traits: { clickAccuracy: 0, typingAccuracy: 0.5 },
    });
    const steadyHands = definePersona({
      name: "t",
      traits: { clickAccuracy: 1, typingAccuracy: 0.5 },
    });
    for (let seed = 0; seed < 50; seed++) {
      const a = planTyping("asdfghjklqwerty", shakyHands, createRng(seed));
      const b = planTyping("asdfghjklqwerty", steadyHands, createRng(seed));
      expect(a.typoCount).toBe(b.typoCount);
    }
  });

  it("legacy specs inherit typingAccuracy from clickAccuracy", () => {
    const persona = definePersona({ name: "t", traits: { clickAccuracy: 0.4 } });
    expect(persona.traits.typingAccuracy).toBe(0.4);
  });

  it("soft keyboards stay slower and typo-prone", () => {
    const persona = definePersona({ name: "t" });
    const hard = planTyping("hello world", persona, createRng(1));
    const soft = planSoftKeyType("hello world", persona, createRng(1));
    expect(soft.perCharIntervalMs).toBeGreaterThan(hard.perCharIntervalMs);
  });
});
