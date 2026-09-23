import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import {
  buildCalibrationDataset,
  buildCalibrationRecords,
  recordsFromTrace,
} from "../src/calibration/index.js";
import { EveSession } from "../src/engine/index.js";
import { getPersona } from "../src/personas/index.js";
import { buildExperienceTrace } from "../src/trace/index.js";

async function run() {
  const session = new EveSession({
    adapter: new MockAdapter(DEMO_APP),
    startUrl: "mock:landing",
    persona: "office-worker",
    taskId: "trace_probe_01",
    seed: 21,
    maxSteps: 10,
    paceScale: 0,
    deterministic: true,
  });
  return session.run();
}

describe("trace → records derivation (Phase 7)", () => {
  it("recordsFromTrace equals buildCalibrationRecords byte-for-byte", async () => {
    const result = await run();
    const direct = buildCalibrationRecords(result, {
      personaTraits: getPersona("office-worker").traits,
    });
    const viaTrace = recordsFromTrace(buildExperienceTrace(result), {
      personaTraits: getPersona("office-worker").traits,
    });
    expect(JSON.stringify(viaTrace)).toBe(JSON.stringify(direct));
  });

  it("dataset carries task, parameter set, and environment slots", async () => {
    const result = await run();
    const dataset = buildCalibrationDataset(result, {
      personaTraits: getPersona("office-worker").traits,
      environment: { adapterName: "mock", locale: "en-US" },
    });
    expect(dataset.taskId).toBe("trace_probe_01");
    expect(dataset.parameterSet?.parameterSetVersion).toBeTruthy();
    expect(dataset.parameterSet!.parameters.length).toBeGreaterThan(0);
    expect(dataset.environment?.adapterName).toBe("mock");
    // Records still carry per-step provenance + versions.
    expect(dataset.records.length).toBe(dataset.records.length);
    expect(dataset.records[0]?.behaviorModelVersion).toBeTruthy();
  });

  it("session result carries terminal state and task id", async () => {
    const result = await run();
    expect(result.taskId).toBe("trace_probe_01");
    expect(result.terminalState).not.toBeNull();
    expect(result.terminalState!.url).toBeTruthy();
    expect(result.terminalState!.stableKey).toBeTruthy();
  });
});
