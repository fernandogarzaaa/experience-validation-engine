import type { Point, Viewport } from "../core/types.js";
import { TOUCH_VISUAL_SURFACE } from "../surface/capabilities.js";
import type { AdapterOptions, BrowserAdapter, DeviceMetrics, RawSnapshot } from "./adapter.js";
import { perceiveAcrossNavigation } from "./navigationRetry.js";
import { PERCEPTION_SCRIPT } from "./perceptionScript.js";

/**
 * Mobile web adapter: real device emulation plus touch actuation.
 *
 * Built on Playwright's device descriptors (viewport, device scale factor,
 * user agent, `hasTouch`, `isMobile`) rather than a hand-rolled viewport
 * resize, because those flags are what actually flips the browser's touch
 * behavior — `pointer: coarse` / `hover: none` media queries, touch event
 * dispatch, and tap-vs-click semantics all key off `hasTouch`/`isMobile` at
 * the context level, not off window dimensions. A resized desktop viewport
 * would still report itself as a mouse-and-hover surface to the page.
 *
 * Always launches Chromium, even for iOS device descriptors that recommend
 * WebKit — this keeps the adapter's runtime footprint identical to the
 * desktop Playwright adapter. Rendering-engine-specific quirks are out of
 * scope for this pass.
 *
 * Actuation is still dumb: `clickAt` performs one tap, `scrollBy` performs
 * one scroll delta. The realism — fat-finger scatter, thumb-reach cost,
 * swipe momentum, soft-keyboard cadence — is composed by the humanizer and
 * the engine, one primitive call at a time. This adapter never decides *how
 * many* taps or scrolls to issue.
 */

/**
 * Approximate on-screen keyboard heights, in CSS px, portrait orientation
 * with the predictive-text bar showing. These are modeled constants (typical
 * vendor keyboard heights), not measurements — no headless browser renders a
 * real IME, so there is nothing to measure at runtime. See
 * {@link DeviceMetrics.softKeyboardHeightPx}.
 */
export const DEVICE_PRESETS = {
  "iPhone 14": { softKeyboardHeightPx: 336 },
  "iPhone SE": { softKeyboardHeightPx: 258 },
  "Pixel 7": { softKeyboardHeightPx: 288 },
  "iPad Mini": { softKeyboardHeightPx: 380 },
} as const;

export type DeviceName = keyof typeof DEVICE_PRESETS;

const DEFAULT_DEVICE: DeviceName = "iPhone 14";

type PlaywrightDeviceDescriptor = {
  viewport: Viewport;
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
};

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
  screenshot(opts?: { type?: "png" }): Promise<Buffer>;
  touchscreen: { tap(x: number, y: number): Promise<void> };
  mouse: { wheel(dx: number, dy: number): Promise<void> };
  keyboard: {
    type(text: string, opts?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
  goBack(opts?: { timeout: number }): Promise<unknown>;
  on(
    event: "dialog",
    handler: (dialog: {
      message(): string;
      dismiss(): Promise<void>;
      accept(): Promise<void>;
    }) => void,
  ): void;
  waitForTimeout(ms: number): Promise<void>;
};

type PlaywrightContext = { newPage(): Promise<PlaywrightPage>; close(): Promise<void> };
type PlaywrightBrowser = {
  newContext(opts: PlaywrightDeviceDescriptor): Promise<PlaywrightContext>;
  close(): Promise<void>;
};

export class MobileAdapter implements BrowserAdapter {
  readonly name = "mobile";
  readonly capabilities = TOUCH_VISUAL_SURFACE;
  readonly deviceMetrics: DeviceMetrics;
  private readonly deviceName: DeviceName;
  private browser: PlaywrightBrowser | null = null;
  private context: PlaywrightContext | null = null;
  private page: PlaywrightPage | null = null;
  private pendingNativeDialogs: string[] = [];
  private readonly options: Required<Pick<AdapterOptions, "headless" | "settleMs">>;

  constructor(options: AdapterOptions = {}) {
    this.options = { headless: options.headless ?? true, settleMs: options.settleMs ?? 400 };
    this.deviceName = isDeviceName(options.device) ? options.device : DEFAULT_DEVICE;
    this.deviceMetrics = {
      softKeyboardHeightPx: DEVICE_PRESETS[this.deviceName].softKeyboardHeightPx,
    };
  }

  /**
   * `viewport` is intentionally ignored: emulating "iPhone 14" means using
   * its real viewport, not whatever generic desktop size the caller passed.
   * A mobile adapter that let the caller override the device's own geometry
   * would defeat the point of device emulation.
   */
  async open(url: string, _viewport: Viewport): Promise<void> {
    const { chromium, devices } = await importPlaywright();
    const descriptor = devices[this.deviceName];
    if (!descriptor) {
      throw new Error(
        `MobileAdapter: Playwright has no device descriptor for "${this.deviceName}". ` +
          `Your installed Playwright version may not know this device yet.`,
      );
    }
    this.browser = (await chromium.launch({
      headless: this.options.headless,
    })) as PlaywrightBrowser;
    this.context = await this.browser.newContext(descriptor);
    this.page = await this.context.newPage();
    this.page.on("dialog", (dialog) => {
      this.pendingNativeDialogs.push(dialog.message());
      void dialog.accept().catch(() => {});
    });
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.page.waitForTimeout(this.options.settleMs);
  }

  async snapshot(): Promise<RawSnapshot> {
    const page = this.requirePage();
    const snap = await perceiveAcrossNavigation(
      () => page.evaluate<RawSnapshot>(PERCEPTION_SCRIPT),
      (ms) => page.waitForTimeout(ms),
    );
    if (this.pendingNativeDialogs.length > 0) {
      snap.dialogs = [
        ...snap.dialogs,
        ...this.pendingNativeDialogs.map((text) => ({ text, box: null })),
      ];
      this.pendingNativeDialogs = [];
    }
    return snap;
  }

  async screenshot(): Promise<Buffer | null> {
    try {
      return await this.requirePage().screenshot({ type: "png" });
    } catch {
      return null;
    }
  }

  /** No persistent pointer on a touch surface; kept as a contract no-op. */
  async moveMouse(): Promise<void> {}

  async clickAt(point: Point): Promise<void> {
    await this.requirePage().touchscreen.tap(point.x, point.y);
    await this.settle();
  }

  /** A double-tap is two taps in quick succession, not a distinct gesture. */
  async doubleClickAt(point: Point): Promise<void> {
    const page = this.requirePage();
    await page.touchscreen.tap(point.x, point.y);
    await page.touchscreen.tap(point.x, point.y);
    await this.settle();
  }

  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    await this.requirePage().keyboard.type(text, { delay: perCharIntervalMs });
  }

  async pressKey(key: string): Promise<void> {
    await this.requirePage().keyboard.press(key);
    await this.settle();
  }

  async scrollBy(deltaY: number): Promise<void> {
    await this.requirePage().mouse.wheel(0, deltaY);
    await this.settle();
  }

  async goBack(): Promise<void> {
    await this.requirePage()
      .goBack({ timeout: 15_000 })
      .catch(() => {});
    await this.settle();
  }

  async navigate(url: string): Promise<void> {
    await this.requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.settle();
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private requirePage(): PlaywrightPage {
    if (!this.page) throw new Error("MobileAdapter: call open() first");
    return this.page;
  }

  private async settle(): Promise<void> {
    if (this.options.settleMs > 0) await this.requirePage().waitForTimeout(this.options.settleMs);
  }
}

function isDeviceName(value: string | undefined): value is DeviceName {
  return value !== undefined && Object.hasOwn(DEVICE_PRESETS, value);
}

async function importPlaywright(): Promise<{
  chromium: { launch(opts: { headless: boolean }): Promise<unknown> };
  devices: Record<string, PlaywrightDeviceDescriptor>;
}> {
  try {
    const spec = "playwright";
    return (await import(spec)) as never;
  } catch {
    throw new Error(
      'MobileAdapter requires the optional peer dependency "playwright". Install it with: npm install playwright',
    );
  }
}
