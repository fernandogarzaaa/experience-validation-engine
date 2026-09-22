import { describe, expect, it } from "vitest";
import {
  BEHAVIOR_PARAMETERS,
  getParameter,
  parametersByClass,
  snapshotParameters,
} from "../src/calibration/index.js";
import { createRng } from "../src/core/random.js";
import { getPersona } from "../src/personas/index.js";
import {
  abandonmentThreshold,
  clickScatterPx,
  motorActionMs,
  typingIntervalMs,
} from "../src/personas/persona.js";

describe("parameter registry (Phase 5)", () => {
  it("has unique ids and sane classifications", () => {
    const ids = BEHAVIOR_PARAMETERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BEHAVIOR_PARAMETERS) {
      expect(["STRUCTURAL", "EMPIRICAL", "POLICY"]).toContain(p.classification);
      expect(p.description).toBeTruthy();
      expect(p.source).toBeTruthy();
      if (p.classification === "EMPIRICAL" && typeof p.value === "number") {
        expect(p.bounds, `${p.id} needs prior bounds`).toBeDefined();
        expect(p.value).toBeGreaterThanOrEqual(p.bounds!.min);
        expect(p.value).toBeLessThanOrEqual(p.bounds!.max);
      }
    }
    expect(parametersByClass("EMPIRICAL").length).toBeGreaterThan(0);
    expect(parametersByClass("STRUCTURAL").length).toBeGreaterThan(0);
    expect(parametersByClass("POLICY").length).toBeGreaterThan(0);
  });

  it("mirrors computable values from their source functions (no drift)", () => {
    const persona = getPersona("office-worker");
    const t = persona.traits;
    // abandonmentThreshold = 0.55 + patience * 0.4
    expect(getParameter("abandon.frustrationBase")!.value).toBe(0.55);
    expect(getParameter("abandon.frustrationPatienceRange")!.value).toBe(0.4);
    expect(abandonmentThreshold(persona)).toBeCloseTo(0.55 + t.patience * 0.4, 10);
    // clickScatterPx = (1 - clickAccuracy) * 14
    expect(clickScatterPx(persona)).toBeCloseTo((1 - t.clickAccuracy) * 14, 10);
    // motorActionMs = 1400 - motorSpeed * 1000
    expect(motorActionMs(persona)).toBeCloseTo(1400 - t.motorSpeed * 1000, 10);
    // typingIntervalMs = 300 - motorSpeed * 190
    expect(typingIntervalMs(persona)).toBeCloseTo(300 - t.motorSpeed * 190, 10);
    void createRng;
  });

  it("snapshots are serializable and versioned", () => {
    const snap = snapshotParameters("1.0.0");
    expect(snap.parameterSetVersion).toBe("1.0.0");
    expect(snap.parameters.length).toBe(BEHAVIOR_PARAMETERS.length);
    expect(() => JSON.stringify(snap)).not.toThrow();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(JSON.parse(JSON.stringify(snap)));
  });

  it("getParameter returns undefined for unknown ids", () => {
    expect(getParameter("nope.missing")).toBeUndefined();
  });
});
