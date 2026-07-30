import type { Point, Viewport } from "../core/types.js";
import { VISUAL_SURFACE } from "../surface/capabilities.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
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
  private readonly options: Required<AdapterOptions>;

  constructor(options: AdapterOptions = {}) {
    this.options = { headless: options.headless ?? true, settleMs: options.settleMs ?? 400 };
  }

  async open(url: string, viewport: Viewport): Promise<void> {
    const puppeteer = await importPuppeteer();
    this.browser = (await puppeteer.launch({
      headless: this.options.headless,
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
    const snap = await this.requirePage().evaluate<RawSnapshot>(PERCEPTION_SCRIPT);
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
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.requirePage().mouse.click(point.x, point.y, { clickCount: 2 });
  }

  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    await this.requirePage().keyboard.type(text, { delay: perCharIntervalMs });
  }

  async pressKey(key: string): Promise<void> {
    await this.requirePage().keyboard.press(key);
  }

  async scrollBy(deltaY: number): Promise<void> {
    await this.requirePage().mouse.wheel({ deltaY });
  }

  async goBack(): Promise<void> {
    await this.requirePage()
      .goBack({ timeout: 15_000 })
      .catch(() => {});
  }

  async navigate(url: string): Promise<void> {
    await this.requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importPuppeteer(): Promise<{
  launch(opts: { headless: boolean }): Promise<unknown>;
}> {
  try {
    // Variable specifier: optional peer — must not be resolved at compile time.
    const spec = "puppeteer";
    const mod = (await import(spec)) as { default?: unknown };
    return (mod.default ?? mod) as never;
  } catch {
    throw new Error(
      'PuppeteerAdapter requires the optional peer dependency "puppeteer". Install it with: npm install puppeteer',
    );
  }
}
