import { describe, expect, it } from "vitest";

import type { BrowserAdapter, RawSnapshot } from "../src/browser/adapter.js";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import type { Point, Viewport } from "../src/core/types.js";
import { EveSession } from "../src/engine/index.js";

/**
 * Wraps a real adapter, delegating everything to it except `snapshot()`,
 * which throws once the call count reaches `crashOnCall` — simulating a mid-
 * session adapter failure (network drop, browser crash, an unguarded
 * plugin). Tracks whether/how often `close()` was invoked so the test can
 * assert cleanup happened exactly once.
 */
class CrashingAdapter implements BrowserAdapter {
  readonly name = "crashing-mock";
  readonly capabilities: BrowserAdapter["capabilities"];
  closeCallCount = 0;
  snapshotCallCount = 0;

  constructor(
    private readonly inner: BrowserAdapter,
    private readonly crashOnCall: number,
    private readonly crashMessage = "simulated adapter crash: browser process died",
  ) {
    this.capabilities = inner.capabilities;
  }

  open(url: string, viewport: Viewport): Promise<void> {
    return this.inner.open(url, viewport);
  }

  async snapshot(): Promise<RawSnapshot> {
    this.snapshotCallCount += 1;
    if (this.snapshotCallCount === this.crashOnCall) {
      throw new Error(this.crashMessage);
    }
    return this.inner.snapshot();
  }

  screenshot(): Promise<Buffer | null> {
    return this.inner.screenshot();
  }

  moveMouse(point: Point): Promise<void> {
    return this.inner.moveMouse(point);
  }

  clickAt(point: Point): Promise<void> {
    return this.inner.clickAt(point);
  }

  doubleClickAt(point: Point): Promise<void> {
    return this.inner.doubleClickAt(point);
  }

  typeText(text: string, perCharIntervalMs: number): Promise<void> {
    return this.inner.typeText(text, perCharIntervalMs);
  }

  pressKey(key: string): Promise<void> {
    return this.inner.pressKey(key);
  }

  scrollBy(deltaY: number): Promise<void> {
    return this.inner.scrollBy(deltaY);
  }

  goBack(): Promise<void> {
    return this.inner.goBack();
  }

  navigate(url: string): Promise<void> {
    return this.inner.navigate(url);
  }

  async close(): Promise<void> {
    this.closeCallCount += 1;
    await this.inner.close();
  }
}

describe("EveSession.run() surviving a mid-session adapter crash", () => {
  it("closes the adapter and returns a partial result instead of rejecting", async () => {
    // Two full steps' worth of snapshots (observe + observe-again each)
    // succeed before the crash, so the partial result carries real gathered
    // data, not just an empty shell.
    const adapter = new CrashingAdapter(new MockAdapter(DEMO_APP), 5);
    const session = new EveSession({
      adapter,
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 42,
      maxSteps: 25,
      paceScale: 0,
    });

    const result = await session.run();

    // The adapter must always be released, exactly once.
    expect(adapter.closeCallCount).toBe(1);

    // The crash must be visible, not silently swallowed.
    expect(result.error).toContain("simulated adapter crash");
    expect(result.endReason).toBe("crashed");

    // Whatever was gathered before the throw must still come back, built
    // through the same path a normal completion uses.
    expect(result.iterations.length).toBeGreaterThan(0);
    expect(result.scores.length).toBeGreaterThan(0);
    for (const score of result.scores) {
      expect(Number.isFinite(score.value)).toBe(true);
    }
    expect(result.usage.steps).toBe(result.iterations.length);
  }, 30_000);

  it("still closes the adapter and returns a result when the very first perception crashes", async () => {
    const adapter = new CrashingAdapter(new MockAdapter(DEMO_APP), 1);
    const session = new EveSession({
      adapter,
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 1,
      maxSteps: 10,
      paceScale: 0,
    });

    const result = await session.run();

    expect(adapter.closeCallCount).toBe(1);
    expect(result.error).toContain("simulated adapter crash");
    expect(result.endReason).toBe("crashed");
    expect(result.iterations).toEqual([]);
    // Even a totally empty session must still produce a well-formed result.
    expect(Array.isArray(result.scores)).toBe(true);
    expect(result.usage).toBeDefined();
  }, 30_000);

  it("still closes the adapter when adapter.open() itself throws", async () => {
    const inner = new MockAdapter(DEMO_APP);
    const adapter: BrowserAdapter & { closeCallCount: number } = {
      ...inner,
      closeCallCount: 0,
      capabilities: inner.capabilities,
      open: async () => {
        throw new Error("simulated launch failure: could not start browser");
      },
      close: async function (this: { closeCallCount: number }) {
        this.closeCallCount += 1;
      },
    } as BrowserAdapter & { closeCallCount: number };

    const session = new EveSession({
      adapter,
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 1,
      maxSteps: 10,
      paceScale: 0,
    });

    const result = await session.run();

    expect(adapter.closeCallCount).toBe(1);
    expect(result.error).toContain("simulated launch failure");
    expect(result.endReason).toBe("crashed");
    expect(result.iterations).toEqual([]);
  }, 30_000);

  it("does not report a crash on an ordinary successful run", async () => {
    const adapter = new CrashingAdapter(new MockAdapter(DEMO_APP), Number.POSITIVE_INFINITY);
    const session = new EveSession({
      adapter,
      startUrl: "mock:landing",
      persona: "curious-explorer",
      seed: 42,
      maxSteps: 10,
      paceScale: 0,
    });

    const result = await session.run();

    expect(adapter.closeCallCount).toBe(1);
    expect(result.error).toBeNull();
    expect(result.endReason).not.toBe("crashed");
  }, 30_000);
});
