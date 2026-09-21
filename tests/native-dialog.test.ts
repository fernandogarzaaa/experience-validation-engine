import { describe, expect, it } from "vitest";
import {
  mergeNativeDialogs,
  PERCEPTION_SCRIPT,
  recordNativeDialog,
  resolveNativeDialogHandling,
} from "../src/browser/index.js";
import { HeuristicCognition } from "../src/cognition/heuristicCognition.js";
import { visibleText } from "../src/cognition/mentalModel.js";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { OperatorMemory } from "../src/memory/index.js";
import { getPersona } from "../src/personas/index.js";
import { createGoal, GoalStack } from "../src/planning/index.js";

function percept(): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: [],
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("native dialog handling (P0.2)", () => {
  it("defaults to dismiss: undefined/anything-but-accept never auto-accepts", () => {
    expect(resolveNativeDialogHandling(undefined)).toBe("dismissed");
    expect(resolveNativeDialogHandling("dismiss")).toBe("dismissed");
    expect(resolveNativeDialogHandling("accept")).toBe("accepted");
  });

  it("records dialog text and reports safe handling", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    const handling = recordNativeDialog(pending, "Delete everything?", undefined);
    expect(handling).toBe("dismissed");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).toBe("Delete everything?");
  });

  it("explicit opt-in accept is honored and labeled", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    expect(recordNativeDialog(pending, "OK?", "accept")).toBe("accepted");
    expect(pending[0]!.autoHandled).toBe("accepted");
  });

  it("merges as cognition-visible native dialogs and drains the queue", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    recordNativeDialog(pending, "Are you sure?", undefined);
    const merged = mergeNativeDialogs([], pending);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("native");
    expect(merged[0]!.autoHandled).toBe("dismissed");
    expect(pending).toHaveLength(0);
  });

  it("dialog text reaches cognition via visibleText (perception, not bypass)", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    recordNativeDialog(pending, "Submit payment?", undefined);
    const p = { ...percept(), dialogs: mergeNativeDialogs([], pending) };
    expect(visibleText(p)).toContain("Submit payment?");
  });

  it("destructive confirmations are never auto-accepted by default", () => {
    for (const text of ["Delete everything?", "Are you sure?", "Submit payment?", "Leave page?"]) {
      const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
      expect(recordNativeDialog(pending, text, undefined)).toBe("dismissed");
    }
  });
});

describe("native dialog cognition (CodeRabbit PR #39)", () => {
  function dialogPercept(): Percept {
    const el: VisibleElement = {
      id: 0,
      role: "button",
      text: "Continue",
      box: { x: 10, y: 10, width: 120, height: 36 },
      interactive: true,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
    };
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    recordNativeDialog(pending, "Delete everything?", undefined);
    return {
      timestamp: 0,
      url: "https://x.test/",
      title: "T",
      viewport: { width: 1280, height: 800 },
      scrollY: 0,
      scrollHeight: 800,
      screenshot: null,
      elements: [el],
      dialogs: mergeNativeDialogs([], pending),
      loadingIndicator: false,
    };
  }

  it("reads a native dialog instead of clicking an unrelated page control", async () => {
    const persona = getPersona("office-worker");
    const policy = new HeuristicCognition();
    const decision = await policy.decide({
      percept: dialogPercept(),
      previousPercept: null,
      persona,
      emotion: {
        confidence: 0.5,
        frustration: 0.1,
        trust: 0.5,
        confusion: 0.1,
        curiosity: 0.5,
        fatigue: 0.1,
        satisfaction: 0.5,
        interest: 0.5,
        stress: 0.1,
      },
      memory: new OperatorMemory(persona, createRng(1)),
      goals: new GoalStack(createGoal("finish the task")),
      rng: createRng(1),
      step: 0,
      elapsedMs: 0,
    });
    // A read, never a click on "Continue": the dialog was already handled.
    expect(decision.action.kind).toBe("read");
    if (decision.action.kind === "click") {
      throw new Error("native dialog mapped to a page click");
    }
    expect(decision.rationale).toContain("Delete everything?");
  });
});

describe("password secrecy in perception (CodeRabbit PR #39)", () => {
  it("never forwards input values for password fields", () => {
    // Static guard on the shipped script: the INPUT branch must detect
    // type=password BEFORE touching el.value.
    const inputBranch = PERCEPTION_SCRIPT.slice(
      PERCEPTION_SCRIPT.indexOf('tag === "INPUT"'),
      PERCEPTION_SCRIPT.indexOf('} else if (tag === "IMG")'),
    );
    expect(inputBranch).toContain("password");
    const valueRead = inputBranch.indexOf("el.value");
    const passwordCheck = inputBranch.indexOf("password");
    expect(passwordCheck).toBeGreaterThanOrEqual(0);
    expect(valueRead).toBeGreaterThan(passwordCheck);
  });
});
