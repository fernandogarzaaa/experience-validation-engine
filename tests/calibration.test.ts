import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { simulatePopulation, type PopulationStudy } from "../src/population/index.js";
import {
  calibrate,
  importHumanStudy,
  renderCalibrationMarkdown,
  type HumanStudy,
} from "../src/calibration/index.js";
import { runCalibrate } from "../src/mcp/tools.js";
import { CalibrateSchema } from "../src/mcp/schemas.js";

describe("human validation / calibration", () => {
  let study: PopulationStudy;
  let matching: HumanStudy;
  beforeAll(async () => {
    study = await simulatePopulation({ url: "mock:", size: 16, seed: 7, maxSteps: 25, concurrency: 8 });
    // "Humans" mirroring EVE's own behaviour — the identity case.
    matching = {
      task: "explore",
      traces: study.operators.map((o) => ({
        completed: o.completed,
        abandoned: o.abandoned,
        path: [...o.path],
        steps: o.steps,
        frustration: o.emotions.frustration,
        confidence: o.emotions.confidence,
        ...(o.dropoffScreen ? { abandonedOn: o.dropoffScreen } : {}),
      })),
    };
  }, 120_000);

  it("scores a near-identical human study very high", () => {
    const report = calibrate(matching, study);
    expect(report.similarityScore).toBeGreaterThan(85);
    expect(report.behaviorSimilarity).toBeGreaterThan(0.9);
    expect(report.navigationSimilarity).toBeGreaterThan(0.9);
  });

  it("scores a divergent human study lower", () => {
    const divergent: HumanStudy = {
      task: "explore",
      traces: Array.from({ length: 16 }, () => ({
        completed: true,
        abandoned: false,
        path: ["mock://other/x", "mock://other/y"],
        steps: 2,
        frustration: 0,
        confidence: 1,
      })),
    };
    const matchReport = calibrate(matching, study);
    const divReport = calibrate(divergent, study);
    expect(divReport.similarityScore).toBeLessThan(matchReport.similarityScore);
    expect(divReport.navigationSimilarity).toBeLessThan(0.5); // disjoint paths
  });

  it("omits alignments the humans didn't report", () => {
    const noEmotion: HumanStudy = {
      traces: [
        { completed: true, path: ["a", "b"] },
        { completed: false, path: ["a"], abandonedOn: "a" },
      ],
    };
    const report = calibrate(noEmotion, study);
    expect(report.frustrationAlignment).toBeNull();
    expect(report.confidenceAlignment).toBeNull();
    expect(report.notes.some((n) => /frustration/i.test(n))).toBe(true);
  });

  it("renders a Markdown report", () => {
    const md = renderCalibrationMarkdown(calibrate(matching, study));
    expect(md).toContain("Human validation");
    expect(md).toContain("Similarity score");
  });
});

describe("importHumanStudy", () => {
  it("normalizes a valid study", () => {
    const study = importHumanStudy({ task: "t", traces: [{ completed: true, path: ["a"], frustration: 0.2 }] });
    expect(study.traces).toHaveLength(1);
    expect(study.traces[0]!.frustration).toBe(0.2);
  });

  it("rejects malformed input", () => {
    expect(() => importHumanStudy(null)).toThrow();
    expect(() => importHumanStudy({})).toThrow(/traces/);
    expect(() => importHumanStudy({ traces: [{ path: ["a"] }] })).toThrow(/completed/);
    expect(() => importHumanStudy({ traces: [{ completed: true }] })).toThrow(/path/);
  });
});

describe("mcp eve_calibrate", () => {
  it("calibrates against a human-study file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cal-"));
    const file = join(dir, "humans.json");
    try {
      await writeFile(
        file,
        JSON.stringify({
          task: "explore",
          traces: [
            { completed: false, path: ["mock://acme-notes/dashboard"], abandonedOn: "mock://acme-notes/dashboard" },
            { completed: true, path: ["mock://acme-notes/dashboard", "mock://acme-notes/editor"] },
          ],
        }),
        "utf8",
      );
      const input = CalibrateSchema.parse({ human_file: file, url: "mock:", size: 8, seed: 1, max_steps: 20, concurrency: 4 });
      const out = await runCalibrate(input);
      expect(out.markdown).toContain("calibration report");
      expect(typeof out.structured.similarityScore).toBe("number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("errors clearly when the file is missing", async () => {
    const input = CalibrateSchema.parse({ human_file: "/nonexistent/humans.json", url: "mock:", size: 4 });
    await expect(runCalibrate(input)).rejects.toThrow(/Could not read/);
  });
});
