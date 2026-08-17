import type { BrowserAdapter } from "../browser/adapter.js";
import { type Clock, WALL_CLOCK } from "../core/clock.js";
import type { BoundingBox, Percept, VisibleElement } from "../core/types.js";

/**
 * The observation layer turns raw adapter snapshots into {@link Percept}s —
 * timestamped, immutable records of what the operator saw. It also measures
 * perceived latency: the time a human experiences between acting and the
 * screen settling, read from the {@link Clock} it is given. Against a real
 * browser that is the wall clock, because the wait is real; against a
 * deterministic surface it is a simulated clock, because the wait is modeled
 * and the host machine's scheduling must not reach the percept.
 *
 * On touch surfaces it also models soft-keyboard occlusion. No headless
 * browser renders a real on-screen keyboard, so this cannot be perceived from
 * the page the way everything else in a `Percept` is — it is computed here,
 * deterministically, from the adapter's declared `deviceMetrics` and whether
 * a focused editable element is present. That keeps the modeling in one
 * place, clearly attributed, rather than letting it masquerade as sensed data
 * anywhere downstream (findings, reports).
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
    /**
     * Where elapsed time comes from. Defaults to the wall clock so existing
     * callers driving a real browser are unaffected; pass a simulated clock to
     * make a run replayable.
     */
    private readonly clock: Clock = WALL_CLOCK,
  ) {}

  /**
   * Look at the screen. If a loading indicator is visible, keep watching —
   * as a human would — until it clears or patience (settleTimeoutMs) runs
   * out. The time spent watching is the perceived latency.
   */
  async observe(options: ObserveOptions = {}): Promise<Observation> {
    const settleTimeoutMs = options.settleTimeoutMs ?? 8_000;
    const pollMs = options.pollMs ?? 250;
    const start = this.clock.now();

    let snap = await this.adapter.snapshot();
    while (snap.loadingIndicator && this.clock.now() - start < settleTimeoutMs) {
      // `sleep` on a simulated clock advances it by `pollMs` without blocking,
      // so the settle wait is a count of polls rather than a measurement of
      // how busy the host was.
      await this.clock.sleep(pollMs);
      snap = await this.adapter.snapshot();
    }
    const settleMs = this.clock.now() - start;

    const screenshot = options.withScreenshot ? await this.adapter.screenshot() : null;
    const keyboardOcclusion = modelKeyboardOcclusion(this.adapter, snap.viewport, snap.elements);
    const elements = keyboardOcclusion
      ? snap.elements.map((el) =>
          intersectsBottomBand(el.box, keyboardOcclusion)
            ? { ...el, occludedByKeyboard: true }
            : el,
        )
      : snap.elements;
    const percept: Percept = {
      timestamp: this.clock.now() - this.sessionStart,
      url: snap.url,
      title: snap.title,
      viewport: snap.viewport,
      scrollY: snap.scrollY,
      scrollHeight: snap.scrollHeight,
      screenshot,
      elements,
      dialogs: snap.dialogs,
      loadingIndicator: snap.loadingIndicator,
      keyboardOcclusion,
    };
    return { percept, settleMs };
  }
}

/**
 * A modeled soft-keyboard band, or null when none is up. Touch surfaces only,
 * and only while a focused editable element is present — a keyboard has no
 * reason to be showing otherwise.
 */
function modelKeyboardOcclusion(
  adapter: BrowserAdapter,
  viewport: Percept["viewport"],
  elements: readonly VisibleElement[],
): BoundingBox | null {
  if (adapter.capabilities.pointer !== "touch") return null;
  const heightPx = adapter.deviceMetrics?.softKeyboardHeightPx;
  if (!heightPx) return null;
  const focusedEditable = elements.some((el) => el.focused && el.editable);
  if (!focusedEditable) return null;
  const height = Math.min(heightPx, viewport.height);
  return { x: 0, y: viewport.height - height, width: viewport.width, height };
}

function intersectsBottomBand(box: BoundingBox, band: BoundingBox): boolean {
  return box.y + box.height > band.y;
}
