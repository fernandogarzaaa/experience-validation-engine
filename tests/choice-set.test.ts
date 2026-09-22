import { describe, expect, it } from "vitest";
import { utilityChoiceSet } from "../src/cognition/choiceSet.js";
import { HeuristicCognition } from "../src/cognition/heuristicCognition.js";
import type { SalienceScore } from "../src/cognition/salience.js";
import type { UtilityScore } from "../src/cognition/utility.js";
import { UtilityCognition } from "../src/cognition/utilityCognition.js";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { OperatorMemory } from "../src/memory/index.js";
import { getPersona } from "../src/personas/index.js";
import { createGoal, GoalStack } from "../src/planning/index.js";

let id = 0;
function el(text: string, overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: id++,
    role: "button",
    text,
    box: { x: 10, y: 10 + id * 40, width: 120, height: 36 },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(elements: VisibleElement[], dialogs: Percept["dialogs"] = []): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs,
    loadingIndicator: false,
  };
}

function ctxFor(p: Percept, goal = "water the plants", personaName = "office-worker") {
  const persona = getPersona(personaName);
  const memory = new OperatorMemory(persona, createRng(1));
  // Seen twice: not novel, so the cascade reaches affordance choice
  // instead of the first-encounter read. Goal keywords unrelated to the
  // labels, so no strong-goal-match shortcut fires either.
  memory.observeScreen(p, 0);
  memory.observeScreen(p, 1);
  return {
    percept: p,
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
    memory,
    goals: new GoalStack(createGoal(goal)),
    rng: createRng(1),
    step: 0,
    elapsedMs: 0,
  };
}

describe("ChoiceSet recording (Phase 3)", () => {
  it("heuristic cascade records ordered candidates WITHOUT probabilities", async () => {
    const p = percept([el("Save"), el("Cancel"), el("Delete")]);
    const decision = await new HeuristicCognition().decide(ctxFor(p));
    const set = decision.choiceSet;
    expect(set).toBeDefined();
    expect(set!.kind).toMatch(/heuristic-ordered|deterministic-single/);
    expect(set!.candidates.length).toBeGreaterThan(0);
    for (const c of set!.candidates) {
      // The cascade never computes probabilities — none must be recorded.
      expect(c.probability).toBeUndefined();
    }
    if (set!.kind === "heuristic-ordered") {
      const ranks = set!.candidates.filter((c) => c.eligible).map((c) => c.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => (a ?? 0) - (b ?? 0)));
      expect(set!.selectedIndex).not.toBeNull();
    }
  });

  it("utility policy records a real softmax distribution", async () => {
    const p = percept([el("Save"), el("Cancel"), el("Delete")]);
    const decision = await new UtilityCognition().decide(ctxFor(p));
    const set = decision.choiceSet;
    expect(set).toBeDefined();
    if (set!.kind === "probabilistic") {
      // Only ELIGIBLE candidates carry probabilities; ineligible ones
      // (risk-refused, below-threshold) are recorded without them.
      const eligible = set!.candidates.filter((c) => c.eligible);
      const probs = eligible.map((c) => c.probability ?? NaN);
      expect(probs.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
      expect(set!.temperature).toBeGreaterThan(0);
      for (const c of eligible) expect(c.score).toBeDefined();
      for (const c of set!.candidates.filter((c) => !c.eligible)) {
        expect(c.probability).toBeUndefined();
        expect(c.ineligibilityReason).toBeTruthy();
      }
    }
  });

  it("non-scoring branches record nothing (explicit absence)", async () => {
    const p = percept([el("Save")], [{ text: "Are you sure?", box: null }]);
    const decision = await new HeuristicCognition().decide(ctxFor(p));
    // Dialog branch selects without scoring.
    expect(decision.choiceSet).toBeUndefined();
  });

  it("choice recording is deterministic and consumes no RNG", async () => {
    const p = percept([el("Save"), el("Cancel"), el("Delete")]);
    const a = await new HeuristicCognition().decide(ctxFor(p));
    const b = await new HeuristicCognition().decide(ctxFor(p));
    expect(JSON.stringify(a.choiceSet)).toBe(JSON.stringify(b.choiceSet));
  });

  it("single-candidate choices carry no probability (CodeRabbit PR #46)", async () => {
    // One eligible button: trivial selection is not a distribution.
    const p = percept([el("Save")]);
    for (const policy of [new HeuristicCognition(), new UtilityCognition()]) {
      const decision = await policy.decide(ctxFor(p));
      const set = decision.choiceSet;
      expect(set).toBeDefined();
      expect(set!.kind).toBe("deterministic-single");
      expect(set!.candidates).toHaveLength(1);
      expect(set!.candidates[0]!.probability).toBeUndefined();
      expect(set!.temperature).toBeUndefined();
      expect(set!.selectedIndex).toBe(0);
    }
  });

  it("keyboard actuations null the selected index (CodeRabbit PR #46)", async () => {
    // power-user (keyboardPreference 0.85) + focused control → press/Enter.
    // The click set was considered, but the press was not a candidate.
    // Both controls marked focused so whichever wins takes the Enter branch.
    const p = percept([el("Save", { focused: true }), el("Cancel", { focused: true })]);
    const decision = await new HeuristicCognition().decide(
      ctxFor(p, "water the plants", "power-user"),
    );
    expect(decision.action.kind).toBe("press");
    expect(decision.choiceSet).toBeDefined();
    expect(decision.choiceSet!.selectedIndex).toBeNull();
    expect(decision.choiceSet!.candidates.length).toBeGreaterThan(0);
  });

  it("utility sets include barred alternatives as ineligible (CodeRabbit PR #46)", async () => {
    // Builder-level: refused + below-threshold entries are recorded with
    // reasons and no probabilities, while eligible probabilities still
    // describe the sampled distribution.
    const mkUtility = (text: string, utility: number): UtilityScore => ({
      element: el(text),
      features: {
        expectedSuccess: 0.5,
        reward: 0.5,
        curiosity: 0.5,
        risk: 0.1,
        effort: 0.1,
        time: 0.1,
      },
      utility,
    });
    const mkSalience = (text: string): SalienceScore => ({
      element: el(text),
      total: 0.9,
      goalRelevance: 0.1,
      prominence: 0.5,
      novelty: 1,
      risk: 1,
    });
    const positive = [mkUtility("Save", 1.0), mkUtility("Cancel", 0.2)];
    const set = utilityChoiceSet(positive, [0.7, 0.3], 0.4, 0, [
      { score: mkSalience("Delete"), reason: "risk-refused" },
    ]);
    expect(set.kind).toBe("probabilistic");
    expect(set.candidates).toHaveLength(3);
    const barred = set.candidates.filter((c) => !c.eligible);
    expect(barred).toHaveLength(1);
    expect(barred[0]!.probability).toBeUndefined();
    expect(barred[0]!.ineligibilityReason).toBe("risk-refused");
    const eligible = set.candidates.filter((c) => c.eligible);
    expect(eligible.map((c) => c.probability)).toEqual([0.7, 0.3]);
  });
});
