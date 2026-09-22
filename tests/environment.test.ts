import { describe, expect, it } from "vitest";
import { fingerprintEnvironment } from "../src/calibration/index.js";

describe("environment fingerprint (Phase 6)", () => {
  it("records only available values, null otherwise", () => {
    const fp = fingerprintEnvironment({
      adapterName: "mock",
      viewport: { width: 1280, height: 800 },
      inputModality: "mouse",
      locale: "en-US",
    });
    expect(fp.adapterName).toBe("mock");
    expect(fp.viewport).toEqual({ width: 1280, height: 800 });
    expect(fp.inputModality).toBe("mouse");
    expect(fp.locale).toBe("en-US");
    // Unavailable-in-headless fields stay null/undefined, never fabricated.
    expect(fp.os === null || typeof fp.os === "string").toBe(true);
    expect(fp.timezone === null || typeof fp.timezone === "string").toBe(true);
  });

  it("empty input yields an all-absent fingerprint", () => {
    const fp = fingerprintEnvironment();
    expect(fp.adapterName).toBeUndefined();
    expect(fp.viewport).toBeUndefined();
    expect(JSON.stringify(fp)).toBe(JSON.stringify({ ...fp }));
  });
});
