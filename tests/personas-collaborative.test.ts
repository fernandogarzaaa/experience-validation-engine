import { describe, expect, it } from "vitest";
import {
  getProfession,
  listProfessions,
  applyProfession,
  getCulture,
  listCultures,
  withCulture,
  cultureOf,
  getPersona,
} from "../src/personas/index.js";
import { runCollaborative } from "../src/collaborative/index.js";
import { MockAdapter, DEMO_APP } from "../src/browser/index.js";
import { discoverJourney } from "../src/workflow/journeys.js";
import { EveSession } from "../src/engine/session.js";
import { WorkflowGraph } from "../src/workflow/graph.js";

describe("professions", () => {
  it("ships the documented professions", () => {
    const names = listProfessions().map((p) => p.name);
    for (const n of ["doctor", "teacher", "lawyer", "designer", "accountant", "student", "salesperson", "executive"]) {
      expect(names).toContain(n);
    }
  });

  it("applying a profession overlays trait deltas and vocabulary", () => {
    const base = getPersona("office-worker");
    const lawyer = applyProfession(base, getProfession("lawyer"));
    // Lawyers are more thorough and more risk-averse.
    expect(lawyer.traits.thoroughness).toBeGreaterThan(base.traits.thoroughness);
    expect(lawyer.traits.riskTolerance).toBeLessThan(base.traits.riskTolerance);
    expect(lawyer.name).toContain("lawyer");
  });

  it("trait overlays stay within valid ranges", () => {
    for (const prof of listProfessions()) {
      const p = applyProfession(getPersona("power-user"), prof);
      expect(p.traits.riskTolerance).toBeGreaterThanOrEqual(0);
      expect(p.traits.riskTolerance).toBeLessThanOrEqual(1);
      expect(p.traits.readingSpeedWpm).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("cultures", () => {
  it("ships LTR and RTL locales", () => {
    const locales = listCultures().map((c) => c.locale);
    expect(locales).toContain("en-US");
    expect(locales).toContain("ar-SA");
    expect(getCulture("ar-SA").readingDirection).toBe("rtl");
    expect(getCulture("ja-JP").dateFormat).toBe("YMD");
  });

  it("attaches culture to a persona", () => {
    const p = withCulture(getPersona("office-worker"), getCulture("de-DE"));
    expect(cultureOf(p).locale).toBe("de-DE");
    expect(cultureOf(p).currency).toBe("€");
  });
});

describe("journey discovery", () => {
  it("reconstructs the path an operator took toward a goal", async () => {
    const graph = new WorkflowGraph();
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:login",
      persona: "office-worker",
      goal: "reset my forgotten password",
      goalSuccessSignals: ["check your email"],
      seed: 7,
      maxSteps: 20,
      paceScale: 0,
    });
    const result = await session.run();
    // The session already discovers a journey.
    expect(result.journey).toBeDefined();
    expect(result.journey!.path.length).toBeGreaterThan(0);
    expect(result.journey!.goal).toContain("reset");
    void graph;
    void discoverJourney;
  }, 30_000);
});

describe("collaborative sessions", () => {
  it("runs a role chain with handoffs and detects completion", async () => {
    const result = await runCollaborative({
      name: "note handoff",
      adapterFactory: () => new MockAdapter(DEMO_APP),
      startUrl: "mock:login",
      seed: 3,
      roles: [
        { name: "author", persona: "office-worker", goal: "log in", goalSuccessSignals: ["your notes"], maxSteps: 20 },
        { name: "reviewer", persona: "power-user", goal: "open settings", goalSuccessSignals: ["settings"], startUrl: "mock:dashboard", maxSteps: 15 },
      ],
    });
    expect(result.roleResults.length).toBe(2);
    expect(result.handoffs.length).toBe(1);
    expect(result.handoffs[0]!.from).toBe("author");
    expect(result.handoffs[0]!.to).toBe("reviewer");
    expect(typeof result.chainCompleted).toBe("boolean");
    expect(result.summary.length).toBeGreaterThan(0);
  }, 40_000);
});
