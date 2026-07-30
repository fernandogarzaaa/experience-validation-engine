import { beforeAll, describe, expect, it } from "vitest";

import {
  EVEBENCH_CASES,
  type EveBenchReport,
  renderEveBenchMarkdown,
  runEveBench,
} from "../src/evebench/index.js";
import { EveBenchSchema } from "../src/mcp/schemas.js";
import { runEveBenchTool } from "../src/mcp/tools.js";

describe("EVE Bench", () => {
  let report: EveBenchReport;
  beforeAll(async () => {
    report = await runEveBench({ seed: 7, maxSteps: 30 });
  }, 180_000);

  it("defines the three reference cases", () => {
    expect(EVEBENCH_CASES.map((c) => c.tier).sort()).toEqual(["average", "bad", "excellent"]);
  });

  it("scores every case on all dimensions", () => {
    expect(report.cases).toHaveLength(3);
    for (const c of report.cases) {
      expect(c.taskSuccess).toBeGreaterThanOrEqual(0);
      expect(c.taskSuccess).toBeLessThanOrEqual(1);
      expect(c.overallScore).toBeGreaterThan(0);
      expect(c.composite).toBeGreaterThan(0);
      expect(c.composite).toBeLessThanOrEqual(100);
      expect(c.learnability).toBeGreaterThanOrEqual(0);
      expect(c.learnability).toBeLessThanOrEqual(1);
    }
  });

  it("holds construct validity (excellent > average > bad)", () => {
    const byTier = Object.fromEntries(report.cases.map((c) => [c.tier, c.composite]));
    expect(byTier.excellent).toBeGreaterThan(byTier.average);
    expect(byTier.average).toBeGreaterThan(byTier.bad);
    expect(report.ordered).toBe(true);
  });

  it("publishes an overall score and renders a scorecard", () => {
    expect(report.overall).toBeGreaterThan(0);
    expect(report.overall).toBeLessThanOrEqual(100);
    const md = renderEveBenchMarkdown(report);
    expect(md).toContain("EVE Bench");
    expect(md).toContain("Composite");
  });
});

describe("mcp eve_bench", () => {
  it("runs the scorecard via the MCP tool", async () => {
    const out = await runEveBenchTool(EveBenchSchema.parse({ seed: 7, max_steps: 30 }));
    expect(out.markdown).toContain("EVE Bench");
    expect((out.structured.cases as unknown[]).length).toBe(3);
    expect(typeof out.structured.overall).toBe("number");
  }, 180_000);
});
