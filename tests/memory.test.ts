import { describe, expect, it } from "vitest";
import { OperatorMemory, screenSignature } from "../src/memory/index.js";
import { getPersona } from "../src/personas/index.js";
import { createRng } from "../src/core/random.js";
import type { Percept } from "../src/core/types.js";

function percept(url: string, heading: string): Percept {
  return {
    timestamp: 0,
    url,
    title: heading,
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: [
      {
        id: 0,
        role: "heading",
        text: heading,
        box: { x: 0, y: 0, width: 300, height: 40 },
        interactive: false,
        disabled: false,
        editable: false,
        focused: false,
        clippedByViewport: false,
      },
      {
        id: 1,
        role: "button",
        text: "Save",
        box: { x: 0, y: 60, width: 100, height: 36 },
        interactive: true,
        disabled: false,
        editable: false,
        focused: false,
        clippedByViewport: false,
      },
    ],
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("operator memory", () => {
  const persona = getPersona("office-worker");

  it("screen signatures ignore query strings but respect headings", () => {
    const a = screenSignature(percept("https://x.test/app?tab=1", "Dashboard"));
    const b = screenSignature(percept("https://x.test/app?tab=2", "Dashboard"));
    const c = screenSignature(percept("https://x.test/app", "Settings"));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("working memory is capacity-limited", () => {
    const memory = new OperatorMemory(persona, createRng(1));
    for (let i = 0; i < 12; i++) memory.hold(`thought-${i}`, i);
    expect(memory.currentThoughts().length).toBeLessThanOrEqual(6);
  });

  it("episodes decay but strong reinforcement persists", () => {
    const memory = new OperatorMemory(persona, createRng(1));
    const p = percept("https://x.test/", "Home");
    memory.recordEpisode(0, p, null, "click Save", "error");
    for (let i = 0; i < 40; i++) memory.decayEpisodes();
    // Errors are remembered longer (negativity bias) — still recallable.
    expect(memory.remembersFailure(screenSignature(p), "click Save")).toBe(true);
  });

  it("builds a spatial map with transitions and looping detection", () => {
    const memory = new OperatorMemory(persona, createRng(1));
    const home = percept("https://x.test/", "Home");
    const settings = percept("https://x.test/settings", "Settings");
    for (let step = 0; step < 6; step++) {
      memory.observeScreen(step % 2 === 0 ? home : settings, step);
    }
    memory.recordTransition(screenSignature(home), screenSignature(settings), "click Settings");
    expect(memory.knownScreens()).toHaveLength(2);
    expect(memory.knownEdges()).toHaveLength(1);
    expect(memory.loopingScore()).toBeGreaterThan(0.4);
  });

  it("learning reinforces facts", () => {
    const memory = new OperatorMemory(persona, createRng(1));
    memory.learn({ kind: "shortcut", statement: "Ctrl+S saves" });
    memory.learn({ kind: "shortcut", statement: "Ctrl+S saves" });
    const fact = memory.knownFacts("shortcut")[0]!;
    expect(fact.reinforcements).toBe(2);
    expect(fact.confidence).toBeGreaterThan(0.3);
  });
});
