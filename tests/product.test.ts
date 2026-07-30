import { beforeAll, describe, expect, it } from "vitest";

import { RunUsabilityStudySchema } from "../src/mcp/schemas.js";
import { runProductReport } from "../src/mcp/tools.js";
import { type PopulationStudy, simulatePopulation } from "../src/population/index.js";
import {
  type ProductIntelligence,
  inferProductIntelligence,
  renderProductIntelligenceMarkdown,
} from "../src/product/index.js";

describe("product intelligence", () => {
  let study: PopulationStudy;
  let intel: ProductIntelligence;
  beforeAll(async () => {
    study = await simulatePopulation({
      url: "mock:",
      size: 16,
      seed: 7,
      maxSteps: 25,
      concurrency: 8,
    });
    intel = inferProductIntelligence(study);
  }, 120_000);

  it("infers personas that partition the population", () => {
    expect(intel.personas.length).toBeGreaterThan(0);
    const total = intel.personas.reduce((s, p) => s + p.size, 0);
    expect(total).toBe(study.size);
    for (const p of intel.personas) {
      expect(p.successRate).toBeGreaterThanOrEqual(0);
      expect(p.successRate).toBeLessThanOrEqual(1);
      expect(p.typicalPersona.length).toBeGreaterThan(0);
    }
  });

  it("classifies business goals with shares that don't exceed 1", () => {
    expect(intel.businessGoals.length).toBeGreaterThan(0);
    const shareSum = intel.businessGoals.reduce((s, g) => s + g.trafficShare, 0);
    expect(shareSum).toBeLessThanOrEqual(1.001);
    // The mock app's signup screen should map to acquisition.
    expect(intel.businessGoals.some((g) => /acquisition|engagement/i.test(g.goal))).toBe(true);
  });

  it("derives a critical workflow from observed transitions", () => {
    expect(intel.criticalWorkflows.length).toBeGreaterThan(0);
    const primary = intel.criticalWorkflows[0]!;
    expect(primary.sequence.length).toBeGreaterThanOrEqual(2);
    expect(primary.traversals).toBeGreaterThan(0);
  });

  it("ranks feature importance and flags the critical path", () => {
    const scores = intel.featureImportance.map((f) => f.importance);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores); // descending
    expect(intel.featureImportance.some((f) => f.onCriticalPath)).toBe(true);
  });

  it("reports friction pages with reasons", () => {
    for (const f of intel.highFrictionPages) {
      expect(f.reasons.length).toBeGreaterThan(0);
      expect(f.frictionScore).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic for a fixed study", () => {
    const again = inferProductIntelligence(study);
    expect({ ...again, generatedAt: 0 }).toEqual({ ...intel, generatedAt: 0 });
  });

  it("renders a Markdown product report", () => {
    const md = renderProductIntelligenceMarkdown(intel);
    expect(md).toContain("Product intelligence");
    expect(md).toContain("Business goals");
    expect(md).toContain("Feature importance");
  });
});

describe("mcp eve_product_report", () => {
  it("runs product intelligence via the MCP tool", async () => {
    const input = RunUsabilityStudySchema.parse({
      url: "mock:",
      size: 8,
      seed: 1,
      concurrency: 4,
      max_steps: 25,
    });
    const out = await runProductReport(input);
    expect(out.markdown).toContain("Product intelligence");
    expect((out.structured.personas as unknown[]).length).toBeGreaterThan(0);
    expect(out.structured.businessGoals).toBeDefined();
  }, 60_000);
});
