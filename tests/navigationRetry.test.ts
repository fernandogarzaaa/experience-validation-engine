import { describe, expect, it } from "vitest";

import { isNavigationTeardown, perceiveAcrossNavigation } from "../src/browser/navigationRetry.js";

/** Records how long each simulated wait was asked for, without actually waiting. */
function fakeClock() {
  const waits: number[] = [];
  return {
    waits,
    wait: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("isNavigationTeardown", () => {
  it("recognizes the drivers' navigation errors", () => {
    for (const message of [
      "Execution context was destroyed, most likely because of a navigation",
      "Cannot find context with specified id",
      "Execution context is not available in detached frame",
      "frame was detached",
      "Error: Execution context was destroyed",
    ]) {
      expect(isNavigationTeardown(new Error(message)), message).toBe(true);
    }
  });

  it("does not treat a dead browser as a navigation", () => {
    // Retrying these would only delay surfacing the real failure.
    expect(isNavigationTeardown(new Error("Target closed"))).toBe(false);
    expect(isNavigationTeardown(new Error("Browser has been closed"))).toBe(false);
  });

  it("does not treat unrelated failures as a navigation", () => {
    expect(isNavigationTeardown(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isNavigationTeardown(new TypeError("x is not a function"))).toBe(false);
    expect(isNavigationTeardown("some string")).toBe(false);
  });
});

describe("perceiveAcrossNavigation", () => {
  it("returns the first successful percept without waiting", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await perceiveAcrossNavigation(async () => {
      calls += 1;
      return "screen";
    }, clock.wait);
    expect(result).toBe("screen");
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });

  it("looks again when the page navigated mid-percept", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await perceiveAcrossNavigation(async () => {
      calls += 1;
      if (calls < 3) throw new Error("Execution context was destroyed");
      return "settled screen";
    }, clock.wait);
    expect(result).toBe("settled screen");
    expect(calls).toBe(3);
    // Backoff grows so a slow page still gets a chance.
    expect(clock.waits).toEqual([150, 300]);
  });

  it("gives up after the attempt budget and rethrows the navigation error", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      perceiveAcrossNavigation(
        async () => {
          calls += 1;
          throw new Error("Execution context was destroyed");
        },
        clock.wait,
        { attempts: 3, backoffMs: 10 },
      ),
    ).rejects.toThrow("Execution context was destroyed");
    expect(calls).toBe(3);
    // No pause after the final attempt.
    expect(clock.waits).toEqual([10, 20]);
  });

  it("propagates non-navigation errors immediately", async () => {
    const clock = fakeClock();
    let calls = 0;
    await expect(
      perceiveAcrossNavigation(async () => {
        calls += 1;
        throw new Error("Target closed");
      }, clock.wait),
    ).rejects.toThrow("Target closed");
    expect(calls).toBe(1);
    expect(clock.waits).toEqual([]);
  });
});
