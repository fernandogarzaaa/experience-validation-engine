import { describe, expect, it } from "vitest";
import {
  abandonmentThreshold,
  clickScatterPx,
  definePersona,
  getPersona,
  listPersonas,
  readingTimeMs,
  typingIntervalMs,
  workingMemoryCapacity,
} from "../src/personas/index.js";

describe("persona library", () => {
  it("ships the documented archetypes", () => {
    const names = listPersonas().map((p) => p.name);
    for (const expected of [
      "first-time-user",
      "power-user",
      "elderly-user",
      "accessibility-user",
      "impatient-user",
      "curious-explorer",
      "anxious-user",
      "color-blind-user",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("throws a helpful error for unknown personas", () => {
    expect(() => getPersona("nope")).toThrow(/Known personas/);
  });

  it("validates trait ranges", () => {
    expect(() => definePersona({ name: "bad", traits: { patience: 1.5 } })).toThrow(/out of range/);
    expect(() => definePersona({ name: "bad", traits: { readingSpeedWpm: 5 } })).toThrow(
      /readingSpeedWpm/,
    );
  });
});

describe("trait translation", () => {
  it("slow readers take longer to read the same text", () => {
    const slow = getPersona("slow-reader");
    const fast = getPersona("fast-reader");
    expect(readingTimeMs(slow, 200)).toBeGreaterThan(readingTimeMs(fast, 200) * 2);
  });

  it("power users click more precisely than elderly users", () => {
    expect(clickScatterPx(getPersona("power-user"))).toBeLessThan(
      clickScatterPx(getPersona("elderly-user")),
    );
  });

  it("power users type faster than elderly users", () => {
    expect(typingIntervalMs(getPersona("power-user"))).toBeLessThan(
      typingIntervalMs(getPersona("elderly-user")),
    );
  });

  it("working memory capacity stays in the human 3..6 chunk envelope", () => {
    for (const persona of listPersonas()) {
      const capacity = workingMemoryCapacity(persona);
      expect(capacity).toBeGreaterThanOrEqual(3);
      expect(capacity).toBeLessThanOrEqual(6);
    }
  });

  it("impatient users abandon at lower frustration than patient ones", () => {
    expect(abandonmentThreshold(getPersona("impatient-user"))).toBeLessThan(
      abandonmentThreshold(getPersona("elderly-user")),
    );
  });
});
