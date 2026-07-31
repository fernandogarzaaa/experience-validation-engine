import type { BrowserAdapter } from "../browser/adapter.js";
import type { BoundingBox, Percept, VisibleElement } from "../core/types.js";

/**
 * The observation layer turns raw adapter snapshots into {@link Percept}s —
 * timestamped, immutable records of what the operator saw. It also measures
 * perceived latency: the wall-clock a human experiences between acting and
 * the screen settling.
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
    const keyboardOcclusion = modelKeyboardOcclusion(this.adapter, snap.viewport, snap.elements);
    const elements = keyboardOcclusion
      ? snap.elements.map((el) =>
          intersectsBottomBand(el.box, keyboardOcclusion)
            ? { ...el, occludedByKeyboard: true }
            : el,
        )
      : snap.elements;
    const percept: Percept = {
      timestamp: Date.now() - this.sessionStart,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
