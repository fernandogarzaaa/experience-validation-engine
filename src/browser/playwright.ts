import type { Point, Viewport } from "../core/types.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
import { PERCEPTION_SCRIPT } from "./perceptionScript.js";

/**
 * Playwright adapter. Playwright is an optional peer dependency, loaded
 * dynamically so the core package installs without any browser tooling.
 */

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
  screenshot(opts?: { type?: "png" }): Promise<Buffer>;
  mouse: {
    move(x: number, y: number, opts?: { steps?: number }): Promise<void>;
    click(x: number, y: number): Promise<void>;
    dblclick(x: number, y: number): Promise<void>;
    wheel(dx: number, dy: number): Promise<void>;
  };
  keyboard: {
    type(text: string, opts?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
  goBack(opts?: { timeout?: number }): Promise<unknown>;
  on(event: "dialog", handler: (dialog: { message(): string; dismiss(): Promise<void>; accept(): Promise<void> }) => void): void;
  setViewportSize(size: Viewport): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
};

type PlaywrightBrowser = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

export class PlaywrightAdapter implements BrowserAdapter {
  readonly name = "playwright";
  private browser: PlaywrightBrowser | null = null;
  private page: PlaywrightPage | null = null;
  private pendingNativeDialogs: string[] = [];
  private readonly options: Required<AdapterOptions>;

  constructor(options: AdapterOptions = {}) {
    this.options = { headless: options.headless ?? true, settleMs: options.settleMs ?? 400 };
  }

  async open(url: string, viewport: Viewport): Promise<void> {
    const playwright = await importPlaywright();
    this.browser = (await playwright.chromium.launch({
      headless: this.options.headless,
    })) as PlaywrightBrowser;
    this.page = await this.browser.newPage();
    await this.page.setViewportSize(viewport);
    this.page.on("dialog", (dialog) => {
      // Native alert/confirm: a human sees the text, then accepts. We record
      // the message so the next percept can surface it as a dialog.
      this.pendingNativeDialogs.push(dialog.message());
      void dialog.accept().catch(() => {});
    });
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.page.waitForTimeout(this.options.settleMs);
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
      return await this.requirePage().screenshot({ type: "png" });
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
    await this.requirePage().mouse.dblclick(point.x, point.y);
  }

  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    await this.requirePage().keyboard.type(text, { delay: perCharIntervalMs });
  }

  async pressKey(key: string): Promise<void> {
    await this.requirePage().keyboard.press(key);
  }

  async scrollBy(deltaY: number): Promise<void> {
    await this.requirePage().mouse.wheel(0, deltaY);
  }

  async goBack(): Promise<void> {
    await this.requirePage().goBack({ timeout: 15_000 }).catch(() => {});
  }

  async navigate(url: string): Promise<void> {
    await this.requirePage().goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.page = null;
  }

  private requirePage(): PlaywrightPage {
    if (!this.page) throw new Error("PlaywrightAdapter: call open() first");
    return this.page;
  }
}

async function importPlaywright(): Promise<{ chromium: { launch(opts: { headless: boolean }): Promise<unknown> } }> {
  try {
    // Variable specifier: optional peer — must not be resolved at compile time.
    const spec = "playwright";
    return (await import(spec)) as never;
  } catch {
    throw new Error(
      'PlaywrightAdapter requires the optional peer dependency "playwright". Install it with: npm install playwright',
    );
  }
}
