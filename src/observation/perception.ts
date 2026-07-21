import type { Percept } from "../core/types.js";
import type { BrowserAdapter } from "../browser/adapter.js";

/**
 * The observation layer turns raw adapter snapshots into {@link Percept}s —
 * timestamped, immutable records of what the operator saw. It also measures
 * perceived latency: the wall-clock a human experiences between acting and
 * the screen settling.
 */

export interface ObserveOptions {
  /** Capture a screenshot with this percept. */
  withScreenshot?: boolean;
  /** Max ms to wait for a loading indicator to clear before giving up. */
  settleTimeoutMs?: number;
  /** Poll interval while waiting for settle. */
  pollMs?: number;
}

export interface Observation {
  readonly percept: Percept;
  /** Ms spent waiting for the screen to settle (perceived latency). */
  readonly settleMs: number;
}

export class Observer {
  constructor(
    private readonly adapter: BrowserAdapter,
    private readonly sessionStart: number = Date.now(),
  ) {}

  /**
   * Look at the screen. If a loading indicator is visible, keep watching —
   * as a human would — until it clears or patience (settleTimeoutMs) runs
   * out. The time spent watching is the perceived latency.
   */
  async observe(options: ObserveOptions = {}): Promise<Observation> {
    const settleTimeoutMs = options.settleTimeoutMs ?? 8_000;
    const pollMs = options.pollMs ?? 250;
    const start = Date.now();

    let snap = await this.adapter.snapshot();
    while (snap.loadingIndicator && Date.now() - start < settleTimeoutMs) {
      await sleep(pollMs);
      snap = await this.adapter.snapshot();
    }
    const settleMs = Date.now() - start;

    const screenshot = options.withScreenshot ? await this.adapter.screenshot() : null;
    const percept: Percept = {
      timestamp: Date.now() - this.sessionStart,
      url: snap.url,
      title: snap.title,
      viewport: snap.viewport,
      scrollY: snap.scrollY,
      scrollHeight: snap.scrollHeight,
      screenshot,
      elements: snap.elements,
      dialogs: snap.dialogs,
      loadingIndicator: snap.loadingIndicator,
    };
    return { percept, settleMs };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
