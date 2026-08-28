import type { Point, Viewport } from "../core/types.js";
import { VISUAL_SURFACE } from "../surface/capabilities.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
import { importDriver } from "./driverLoader.js";
import { perceiveAcrossNavigation } from "./navigationRetry.js";
import { PERCEPTION_SCRIPT } from "./perceptionScript.js";

/**
 * Puppeteer adapter. Puppeteer is an optional peer dependency, loaded
 * dynamically. Mirrors the Playwright adapter's behavior exactly — the
 * cognition engine cannot tell which adapter is underneath.
 */

type PuppeteerPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
  screenshot(opts?: { type?: "png"; encoding?: "binary" }): Promise<Buffer | Uint8Array>;
  mouse: {
    move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
    click(x: number, y: number, opts?: { clickCount?: number }): Promise<void>;
    wheel(opts: { deltaX?: number; deltaY?: number }): Promise<void>;
  };
  keyboard: {
    type(text: string, opts?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
  goBack(opts?: { timeout?: number }): Promise<unknown>;
  on(
    event: "dialog",
    handler: (dialog: { message(): string; accept(): Promise<void> }) => void,
  ): void;
  setViewport(size: Viewport): Promise<void>;
};

type PuppeteerBrowser = {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
};

export class PuppeteerAdapter implements BrowserAdapter {
  readonly name = "puppeteer";
  readonly capabilities = VISUAL_SURFACE;
  private browser: PuppeteerBrowser | null = null;
  private page: PuppeteerPage | null = null;
  private pendingNativeDialogs: string[] = [];
  private readonly options: Required<Pick<AdapterOptions, "headless" | "settleMs">>;
  private readonly launchArgs: readonly string[];

  /**
   * `args` is a launch-flags escape hatch, not a general option — a real
   * user's machine has a working Chrome sandbox and should never need it. It
   * exists for environments like a root-run container or a hardened CI
   * runner image, where the sandbox helper isn't usable and Chrome refuses
   * to start at all without `--no-sandbox`.
   */
  constructor(options: AdapterOptions & { args?: readonly string[] } = {}) {
    this.options = { headless: options.headless ?? true, settleMs: options.settleMs ?? 400 };
    this.launchArgs = options.args ?? [];
  }

  async open(url: string, viewport: Viewport): Promise<void> {
    const puppeteer = await importPuppeteer();
    this.browser = (await puppeteer.launch({
      headless: this.options.headless,
      args: [...this.launchArgs],
    })) as PuppeteerBrowser;
    this.page = await this.browser.newPage();
    await this.page.setViewport(viewport);
    this.page.on("dialog", (dialog) => {
      this.pendingNativeDialogs.push(dialog.message());
      void dialog.accept().catch(() => {});
    });
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await sleep(this.options.settleMs);
  }

  async snapshot(): Promise<RawSnapshot> {
    const page = this.requirePage();
    const snap = await perceiveAcrossNavigation(
      () => page.evaluate<RawSnapshot>(PERCEPTION_SCRIPT),
      sleep,
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
      const data = await this.requirePage().screenshot({ type: "png", encoding: "binary" });
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
    } catch {
      return null;
    }
  }

  async moveMouse(point: Point): Promise<void> {
    await this.requirePage().mouse.move(point.x, point.y, { steps: 8 });
  }

  async clickAt(point: Point): Promise<void> {
    await this.requirePage().mouse.click(point.x, point.y);
    await this.settle();
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.requirePage().mouse.click(point.x, point.y, { clickCount: 2 });
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
    await this.requirePage().mouse.wheel({ deltaY });
    // A wheel event resolves once dispatched, not once the page has scrolled.
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
    this.page = null;
  }

  private requirePage(): PuppeteerPage {
    if (!this.page) throw new Error("PuppeteerAdapter: call open() first");
    return this.page;
  }

  /**
   * Give an action that may navigate a moment to commit. See the identical
   * note on `PlaywrightAdapter.settle` — the two adapters must behave the
   * same or the cognition engine could tell them apart.
   */
  private async settle(): Promise<void> {
    if (this.options.settleMs > 0) await sleep(this.options.settleMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importPuppeteer(): Promise<{
  launch(opts: { headless: boolean; args: string[] }): Promise<unknown>;
}> {
  const mod = (await importDriver("puppeteer", "npm install puppeteer")) as { default?: unknown };
  return (mod.default ?? mod) as never;
}
