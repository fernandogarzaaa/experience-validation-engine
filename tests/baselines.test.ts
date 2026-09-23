import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { GoalGreedyPolicy, RandomPolicy } from "../src/cognition/index.js";
import { EveSession } from "../src/engine/index.js";

async function run(policy: "random" | "greedy", seed: number | string) {
  const session = new EveSession({
    adapter: new MockAdapter(DEMO_APP),
    startUrl: "mock:landing",
    persona: "office-worker",
    policy: policy === "random" ? new RandomPolicy() : new GoalGreedyPolicy(),
    seed,
    maxSteps: 12,
    paceScale: 0,
    deterministic: true,
  });
  return session.run();
}

describe("baseline policies (Phase 12)", () => {
  it("random baseline completes runs deterministically", async () => {
    const a = await run("random", 3);
    const b = await run("random", 3);
    expect(a.iterations.map((i) => i.actionDescription)).toEqual(
      b.iterations.map((i) => i.actionDescription),
    );
    expect(a.iterations.length).toBeGreaterThan(0);
  });

  it("goal-greedy baseline completes runs deterministically", async () => {
    const a = await run("greedy", 3);
    const b = await run("greedy", 3);
    expect(a.iterations.map((i) => i.actionDescription)).toEqual(
      b.iterations.map((i) => i.actionDescription),
    );
  });

  it("baselines record no choice sets (they score nothing)", async () => {
    const result = await run("random", 3);
    for (const it of result.iterations) {
      expect(it.choiceSet).toBeUndefined();
    }
  });

  it("policies carry stable names for records", () => {
    expect(new RandomPolicy().name).toBe("random-baseline");
    expect(new GoalGreedyPolicy().name).toBe("goal-greedy-baseline");
  });
});
