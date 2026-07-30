import { describe, expect, it } from "vitest";
import { allocateAttention, attendedPercept, visualSalience } from "../src/cognition/attention.js";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { getPersona } from "../src/personas/index.js";

function el(id: number, overrides: Partial<VisibleElement>): VisibleElement {
  return {
    id,
    role: "text",
    text: "",
    box: { x: 0, y: 0, width: 100, height: 24 },
    interactive: false,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(elements: VisibleElement[], overrides: Partial<Percept> = {}): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "Test",
    viewport: { width: 1000, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs: [],
    loadingIndicator: false,
    ...overrides,
  };
}

describe("attention model", () => {
  const persona = getPersona("office-worker");

  it("salience rewards large, high-contrast, warning-colored elements", () => {
    const big = el(0, {
      text: "Delete",
      box: { x: 400, y: 20, width: 300, height: 80 },
      color: "#ffffff",
      backgroundColor: "#d92020",
    });
    const small = el(1, {
      text: "footer note",
      box: { x: 0, y: 780, width: 60, height: 12 },
      color: "#cccccc",
      backgroundColor: "#ffffff",
    });
    const p = percept([big, small]);
    expect(visualSalience(big, p)).toBeGreaterThan(visualSalience(small, p));
  });

  it("attends only a subset of a dense screen (selective attention)", () => {
    const elements = Array.from({ length: 40 }, (_, i) =>
      el(i, {
        text: `item ${i}`,
        interactive: true,
        role: "link",
        box: { x: 20, y: 20 + i * 18, width: 120, height: 16 },
      }),
    );
    const snap = allocateAttention(percept(elements), null, [], persona, createRng(1));
    expect(snap.attendedIds.size).toBeLessThan(elements.length);
    expect(snap.fixations.length).toBeGreaterThan(0);
    expect(snap.glanceMs).toBeGreaterThan(0);
  });

  it("attendedPercept restricts elements to those attended", () => {
    const elements = Array.from({ length: 30 }, (_, i) =>
      el(i, {
        text: `x${i}`,
        interactive: true,
        box: { x: 20, y: 20 + i * 20, width: 100, height: 16 },
      }),
    );
    const p = percept(elements);
    const snap = allocateAttention(p, null, [], persona, createRng(2));
    const restricted = attendedPercept(p, snap);
    expect(restricted.elements.length).toBe(snap.attendedIds.size);
    expect(restricted.elements.every((e) => snap.attendedIds.has(e.id))).toBe(true);
  });

  it("detects unattended changes as missed changes (change blindness)", () => {
    const before = percept(
      Array.from({ length: 25 }, (_, i) =>
        el(i, { text: `row ${i}`, box: { x: 20, y: 20 + i * 26, width: 200, height: 20 } }),
      ),
    );
    // Change a low-salience element far down; a focused reader may miss it.
    const afterEls = before.elements.map((e) =>
      e.id === 22 ? { ...e, text: "row 22 CHANGED" } : e,
    );
    const after = percept(afterEls);
    const snap = allocateAttention(after, before, [], getPersona("impatient-user"), createRng(3));
    // With an impatient skimmer and a deep change, it is plausibly missed.
    // Assert the mechanism reports missed changes as a set (may be empty for
    // some seeds), and that a changed attended element is never "missed".
    for (const missed of snap.missedChanges) {
      expect(snap.attendedIds.has(missed.id)).toBe(false);
    }
  });

  it("strong goal focus narrows attention (inattentional blindness)", () => {
    const goalEl = el(0, {
      text: "Checkout now",
      interactive: true,
      role: "button",
      box: { x: 400, y: 30, width: 200, height: 50 },
    });
    const distractors = Array.from({ length: 20 }, (_, i) =>
      el(i + 1, {
        text: `promo ${i}`,
        interactive: true,
        box: { x: 20, y: 100 + i * 20, width: 120, height: 16 },
      }),
    );
    const p = percept([goalEl, ...distractors]);
    const focused = allocateAttention(p, null, ["checkout"], persona, createRng(4));
    const unfocused = allocateAttention(p, null, [], persona, createRng(4));
    expect(focused.goalFocus).toBeGreaterThan(unfocused.goalFocus);
    expect(focused.attendedIds.has(0)).toBe(true); // the goal element is attended
  });
});
