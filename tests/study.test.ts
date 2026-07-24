import { describe, it, expect, beforeAll } from "vitest";

import { simulatePopulation, type PopulationStudy } from "../src/population/index.js";
import {
  moderateStudy,
  runSpecialists,
  renderModeratedStudyMarkdown,
  uxResearcher,
  qaEngineer,
  type ExecutiveStudyReport,
} from "../src/study/index.js";
import { runUserStudy } from "../src/mcp/tools.js";
import { RunUsabilityStudySchema } from "../src/mcp/schemas.js";

describe("AI-moderated user study", () => {
  let study: PopulationStudy;
  let report: ExecutiveStudyReport;
  beforeAll(async () => {
    study = await simulatePopulation({ url: "mock:", size: 16, seed: 7, maxSteps: 25, concurrency: 8 });
    report = moderateStudy(study);
  }, 120_000);

  it("convenes the full six-specialist panel", () => {
    const roles = runSpecialists(study).map((s) => s.role);
    expect(roles).toEqual([
      "UX Researcher",
      "Interaction Designer",
      "Accessibility Specialist",
      "QA Engineer",
      "Behavioral Psychologist",
      "Product Manager",
    ]);
  });

  it("each specialist grounds every observation in evidence", () => {
    for (const s of runSpecialists(study)) {
      expect(s.observations.length).toBeGreaterThan(0);
      for (const o of s.observations) {
        expect(o.evidence.length).toBeGreaterThan(0);
        expect(["critical", "major", "minor", "info"]).toContain(o.severity);
      }
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(["block", "caution", "ship"]).toContain(s.stance);
    }
  });

  it("produces a synthesized executive report", () => {
    expect(["ship", "ship-with-fixes", "do-not-ship"]).toContain(report.verdict);
    expect(report.specialists).toHaveLength(6);
    expect(report.headline.length).toBeGreaterThan(0);
    expect(report.confidence).toBeGreaterThan(0);
    expect(report.confidence).toBeLessThanOrEqual(1);
    // Consensus points are raised by >= 2 specialists by construction.
    for (const c of report.consensus) expect(c.roles.length).toBeGreaterThanOrEqual(2);
    // Priorities are sorted by descending score.
    const scores = report.priorities.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("is deterministic for a fixed study", () => {
    const again = moderateStudy(study);
    expect({ ...again, generatedAt: 0 }).toEqual({ ...report, generatedAt: 0 });
  });

  it("renders a Markdown executive report", () => {
    const md = renderModeratedStudyMarkdown(report);
    expect(md).toContain("AI-moderated user study");
    expect(md).toContain("Specialist reports");
    expect(md).toContain("UX Researcher");
  });

  it("blocks release when a defect is reproduced by a majority", () => {
    // A study where a broken interaction hits >50% of users must not be shipped.
    const badStudy: PopulationStudy = {
      ...study,
      successRate: 0.9,
      dropoffRate: 0.0,
      topFindings: [
        {
          title: "No visible response to: click \"Save\"",
          severity: "major",
          category: "error-recovery",
          operatorsAffected: 15,
          prevalence: 0.94,
          evidence: "Clicking Save did nothing",
          recommendation: "Show a save confirmation",
        },
      ],
    };
    const bad = moderateStudy(badStudy);
    const qa = qaEngineer(badStudy);
    expect(qa.stance).toBe("block");
    expect(bad.verdict).toBe("do-not-ship");
  });

  it("has a UX Researcher who reports the success rate", () => {
    const ux = uxResearcher(study);
    expect(ux.summary).toMatch(/task success/i);
  });
});

describe("mcp eve_run_user_study", () => {
  it("runs the moderated study via the MCP tool", async () => {
    const input = RunUsabilityStudySchema.parse({ url: "mock:", size: 8, seed: 1, concurrency: 4, max_steps: 25 });
    const out = await runUserStudy(input);
    expect(out.markdown).toContain("executive report");
    expect(["ship", "ship-with-fixes", "do-not-ship"]).toContain(out.structured.verdict);
    expect((out.structured.specialists as unknown[]).length).toBe(6);
  }, 60_000);
});
