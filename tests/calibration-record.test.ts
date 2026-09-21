import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import {
  buildCalibrationDataset,
  buildCalibrationRecords,
  renderCalibrationRecordsJsonl,
} from "../src/calibration/index.js";
import { EveSession } from "../src/engine/index.js";
import { getPersona } from "../src/personas/index.js";

describe("calibration record (reviewer additional requirement)", () => {
  it("answers what was seen/believed/predicted/done with provenance", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 11,
      maxSteps: 8,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    expect(result.iterations.length).toBeGreaterThan(0);

    const records = buildCalibrationRecords(result, {
      personaTraits: getPersona("office-worker").traits,
    });
    expect(records).toHaveLength(result.iterations.length);
    for (const r of records) {
      // What did EVE see / believe / predict / do / what happened?
      expect(r.url).toBeTruthy();
      expect(r.stableKey).toBeTruthy();
      expect(r.sensitiveKey).toBeTruthy();
      expect(r.actionDescription).toBeTruthy();
      expect(r.prediction).toBeDefined();
      expect(r.emotion).toBeDefined();
      // Which parameters generated the behavior?
      expect(r.seed).toBe(result.seed);
      expect(r.persona).toBe("office-worker");
      expect(r.personaTraits.clickAccuracy).toBeGreaterThan(0);
      expect(r.policy).toBeTruthy();
      // Observed vs modeled, per section — never a bare number.
      expect(r.provenance.observation).toBe("observed");
      expect(r.provenance.action).toBe("observed");
      expect(r.provenance.emotionUpdate).toBe("heuristic");
      // Was the behavior human-calibrated? Not yet — and it says so.
      expect(r.calibrationStatus).toBe("uncalibrated");
      expect(r.humanReference).toBeNull();
    }
    // Latency evidence flows into the outcome side of the record.
    const withOutcome = records.filter((r) => r.outcome);
    expect(withOutcome.length).toBeGreaterThan(0);
    for (const r of withOutcome) {
      expect(r.outcome!.latencyEvidence).toBeDefined();
      expect(r.provenance.latency).toBe("modeled");
    }
  }, 30_000);

  it("builds a dataset envelope and JSONL that round-trips", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 11,
      maxSteps: 4,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    const dataset = buildCalibrationDataset(result, {
      personaTraits: getPersona("office-worker").traits,
    });
    expect(dataset.persona).toBe("office-worker");
    expect(dataset.records.length).toBe(result.iterations.length);
    const jsonl = renderCalibrationRecordsJsonl(dataset.records);
    const lines = jsonl.split("\n").filter(Boolean);
    expect(lines).toHaveLength(dataset.records.length);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { version: number; calibrationStatus: string };
      expect(parsed.version).toBe(1);
      expect(parsed.calibrationStatus).toBe("uncalibrated");
    }
  }, 30_000);

  it("falls back to SessionResult-carried traits and policy", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 11,
      maxSteps: 2,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    expect(result.personaTraits).toBeDefined();
    expect(result.policyName).toBeTruthy();
    const records = buildCalibrationRecords(result);
    expect(records[0]!.policy).toBe(result.policyName);
  }, 30_000);

  it("carries versioned model identifiers (reviewer §10)", async () => {
    const session = new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 11,
      maxSteps: 2,
      paceScale: 0,
      deterministic: true,
    });
    const result = await session.run();
    expect(result.surfaceAdapter).toBe("mock");
    const records = buildCalibrationRecords(result);
    for (const r of records) {
      expect(r.behaviorModelVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.parameterSetVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.calibrationDatasetVersion).toBeNull();
      expect(r.surfaceAdapter).toBe("mock");
      expect(r.surfaceAdapterVersion).toBeNull();
    }
  }, 30_000);

  it("is deterministic: same seed → identical records, not merely same summary (reviewer)", async () => {
    const run = async () => {
      const session = new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:landing",
        persona: "office-worker",
        seed: 99,
        maxSteps: 10,
        paceScale: 0,
        deterministic: true,
      });
      const result = await session.run();
      return buildCalibrationRecords(result);
    };
    const [a, b, c] = await Promise.all([run(), run(), run()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(b)).toBe(JSON.stringify(c));
    // Percepts, actions AND outcomes repeat — spot-check the full chain.
    expect(a.map((r) => r.actionDescription)).toEqual(b.map((r) => r.actionDescription));
    expect(a.map((r) => r.outcome)).toEqual(b.map((r) => r.outcome));
    expect(a.map((r) => r.sensitiveKey)).toEqual(b.map((r) => r.sensitiveKey));
  }, 60_000);
});
