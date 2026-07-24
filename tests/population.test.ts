import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  simulatePopulation,
  sampleOperators,
  classifySegment,
  segmentPopulation,
  summarize,
  histogram,
  quantile,
  mean,
  stdDev,
  pearson,
  type PopulationStudy,
} from "../src/population/index.js";
import {
  renderStudyJson,
  renderOperatorCsv,
  renderStudyMarkdown,
  writeStudyDataset,
} from "../src/research/index.js";
import { runUsabilityStudy } from "../src/mcp/tools.js";
import { RunUsabilityStudySchema } from "../src/mcp/schemas.js";
import { EXCELLENT_APP, BAD_APP } from "../src/benchmarks/index.js";
import { MockAdapter } from "../src/browser/index.js";
import type { EmotionVector } from "../src/emotion/emotionalState.js";

const STUDY_OPTS = { url: "mock:", size: 12, seed: 7, concurrency: 6, maxSteps: 25 } as const;

function emotions(overrides: Partial<EmotionVector>): EmotionVector {
  return {
    confidence: 0.5,
    frustration: 0.1,
    trust: 0.5,
    confusion: 0.1,
    curiosity: 0.5,
    fatigue: 0.1,
    satisfaction: 0.5,
    interest: 0.5,
    stress: 0.1,
    ...overrides,
  };
}

describe("stats primitives", () => {
  it("computes mean, stdDev and quantiles", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(stdDev([2, 2, 2])).toBe(0);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
  });

  it("summarizes a sample with min <= mean <= max", () => {
    const d = summarize([40, 50, 60, 70]);
    expect(d.count).toBe(4);
    expect(d.min).toBeLessThanOrEqual(d.mean);
    expect(d.mean).toBeLessThanOrEqual(d.max);
    expect(d.median).toBe(55);
  });

  it("buckets a histogram whose shares sum to ~1", () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.total).toBe(10);
    const shareSum = h.bins.reduce((s, b) => s + b.share, 0);
    expect(shareSum).toBeCloseTo(1, 1);
    expect(h.bins.reduce((s, b) => s + b.count, 0)).toBe(10);
  });

  it("handles a degenerate (single-value) histogram", () => {
    const h = histogram([5, 5, 5]);
    expect(h.bins).toHaveLength(1);
    expect(h.bins[0]!.count).toBe(3);
  });

  it("computes Pearson correlation", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBe(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe("segmentation", () => {
  it("classifies representative operators", () => {
    expect(
      classifySegment({ completed: false, abandoned: true, steps: 3, overall: 20, emotions: emotions({}) }),
    ).toBe("early-abandoners");
    expect(
      classifySegment({ completed: false, abandoned: true, steps: 30, overall: 30, emotions: emotions({ frustration: 0.8 }) }),
    ).toBe("frustrated-quitters");
    expect(
      classifySegment({ completed: true, abandoned: false, steps: 5, overall: 90, emotions: emotions({ confidence: 0.8, frustration: 0.05 }) }),
    ).toBe("confident-completers");
    expect(
      classifySegment({ completed: true, abandoned: false, steps: 40, overall: 60, emotions: emotions({ frustration: 0.7 }) }),
    ).toBe("persistent-strugglers");
  });

  it("partitions the whole population (sizes sum to N)", () => {
    const ops = [
      { completed: true, abandoned: false, steps: 5, overall: 90, emotions: emotions({ confidence: 0.8 }) },
      { completed: false, abandoned: true, steps: 2, overall: 10, emotions: emotions({}) },
    ];
    const segs = segmentPopulation(ops);
    expect(segs.reduce((s, x) => s + x.size, 0)).toBe(ops.length);
  });
});

describe("sampleOperators", () => {
  it("is deterministic and round-robins the persona pool", () => {
    const specs = sampleOperators({ url: "mock:", size: 4, personas: ["a", "b"], seed: 3 });
    expect(specs.map((s) => s.persona)).toEqual(["a", "b", "a", "b"]);
    expect(specs.map((s) => s.seed)).toEqual(["3#0", "3#1", "3#2", "3#3"]);
    expect(specs).toEqual(sampleOperators({ url: "mock:", size: 4, personas: ["a", "b"], seed: 3 }));
  });

  it("mixes professions and cultures round-robin when provided", () => {
    const specs = sampleOperators({
      url: "mock:",
      size: 3,
      personas: ["a"],
      professions: ["doctor", "lawyer"],
      cultures: ["en-US"],
    });
    expect(specs.map((s) => s.profession)).toEqual(["doctor", "lawyer", "doctor"]);
    expect(specs.every((s) => s.culture === "en-US")).toBe(true);
  });
});

describe("simulatePopulation (offline)", () => {
  // One shared study + one repeat for the reproducibility check keeps this
  // suite to two population runs rather than one per assertion.
  let study: PopulationStudy;
  let repeat: PopulationStudy;
  beforeAll(async () => {
    study = await simulatePopulation(STUDY_OPTS);
    repeat = await simulatePopulation(STUDY_OPTS);
  }, 120_000);

  it("runs a population against the mock app", () => {
    expect(study.operators).toHaveLength(12);
    expect(study.size).toBe(12);
    expect(study.successRate).toBeGreaterThanOrEqual(0);
    expect(study.successRate).toBeLessThanOrEqual(1);
    expect(study.dropoffRate).toBeGreaterThanOrEqual(0);
    expect(study.overallScore.min).toBeLessThanOrEqual(study.overallScore.max);
    expect(study.segments.reduce((s, x) => s + x.size, 0)).toBe(12);
    expect(study.navigationHeatmap.length).toBeGreaterThan(0);
    for (const e of study.navigationHeatmap) {
      expect(e.reach).toBeGreaterThanOrEqual(0);
      expect(e.reach).toBeLessThanOrEqual(1);
    }
    // End-reason counts partition the population.
    const endTotal = Object.values(study.endReasonBreakdown).reduce((a, b) => a + b, 0);
    expect(endTotal).toBe(12);
  });

  it("is reproducible for a fixed seed", () => {
    expect(study.successRate).toBe(repeat.successRate);
    expect(study.overallScore.mean).toBe(repeat.overallScore.mean);
    expect(study.operators.map((o) => o.overall)).toEqual(repeat.operators.map((o) => o.overall));
  });

  it("aggregates findings with prevalence in [0,1]", () => {
    for (const f of study.topFindings) {
      expect(f.prevalence).toBeGreaterThan(0);
      expect(f.prevalence).toBeLessThanOrEqual(1);
      expect(f.operatorsAffected).toBeLessThanOrEqual(study.size);
    }
  });

  it("renders JSON, CSV and Markdown, and writes the dataset", async () => {
    expect(() => JSON.parse(renderStudyJson(study))).not.toThrow();

    const csv = renderOperatorCsv(study);
    const rows = csv.trim().split("\n");
    expect(rows).toHaveLength(study.size + 1); // header + one row per operator
    expect(rows[0]).toContain("persona");
    expect(rows[0]).toContain("frustration");

    const md = renderStudyMarkdown(study);
    expect(md).toContain("# EVE usability study");
    expect(md).toContain("Expected user segments");

    const dir = await mkdtemp(join(tmpdir(), "eve-study-"));
    try {
      const written = await writeStudyDataset(study, dir);
      const csvOnDisk = await readFile(written.csv, "utf8");
      expect(csvOnDisk.trim().split("\n")).toHaveLength(study.size + 1);
      expect(JSON.parse(await readFile(written.json, "utf8")).size).toBe(study.size);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("population construct validity (EVE Bench)", () => {
  // A population on a well-designed app must, in aggregate, out-experience the
  // same population on a badly-designed app — the population analogue of the
  // single-session benchmark, and the standing validity check for this system.
  it("ranks an excellent app above a bad app in aggregate", async () => {
    const common = {
      url: "mock:home",
      size: 8,
      seed: 5,
      maxSteps: 30,
      concurrency: 8,
      goal: "create an account and get to the main screen",
    } as const;
    const excellent = await simulatePopulation({
      ...common,
      goalSuccessSignals: ["all set"],
      adapterFactory: () => new MockAdapter(EXCELLENT_APP),
    });
    const bad = await simulatePopulation({
      ...common,
      goalSuccessSignals: ["has been created"],
      adapterFactory: () => new MockAdapter(BAD_APP),
    });
    expect(excellent.overallScore.mean).toBeGreaterThan(bad.overallScore.mean);
    expect(excellent.successRate).toBeGreaterThanOrEqual(bad.successRate);
  }, 120_000);
});

describe("mcp eve_run_usability_study", () => {
  it("runs via the MCP tool and returns a bounded structured payload", async () => {
    const input = RunUsabilityStudySchema.parse({ url: "mock:", size: 8, seed: 1, concurrency: 4, max_steps: 25 });
    const out = await runUsabilityStudy(input);
    expect(out.markdown).toContain("EVE usability study");
    expect(out.structured.operatorCount).toBe(8);
    // Inline sample is capped at 10 to bound context.
    expect((out.structured.operatorSample as unknown[]).length).toBeLessThanOrEqual(10);
    expect(out.structured.successRate).toBeDefined();
  }, 60_000);
});
