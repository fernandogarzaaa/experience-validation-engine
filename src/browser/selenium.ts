import type { Point, Viewport } from "../core/types.js";
import { VISUAL_SURFACE } from "../surface/capabilities.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
import { perceiveAcrossNavigation } from "./navigationRetry.js";
import { PERCEPTION_SCRIPT } from "./perceptionScript.js";

/**
 * Selenium WebDriver adapter. `selenium-webdriver` is an optional peer
 * dependency, loaded dynamically. Pointer gestures use the W3C Actions API
 * so clicks land at explicit viewport coordinates like the other adapters.
 */

type SeleniumDriver = {
  get(url: string): Promise<void>;
  executeScript<T>(script: string): Promise<T>;
  takeScreenshot(): Promise<string>;
  actions(opts?: { async?: boolean }): SeleniumActions;
  navigate(): { back(): Promise<void> };
  quit(): Promise<void>;
  manage(): {
    window(): { setRect(rect: { width: number; height: number }): Promise<void> };
    setTimeouts(t: { pageLoad?: number; script?: number }): Promise<void>;
  };
  switchTo(): { alert(): Promise<{ getText(): Promise<string>; accept(): Promise<void> }> };
  sleep?(ms: number): Promise<void>;
};

type SeleniumActions = {
  move(opts: { x: number; y: number; origin?: unknown; duration?: number }): SeleniumActions;
  press(): SeleniumActions;
  release(): SeleniumActions;
  click(): SeleniumActions;
  doubleClick(): SeleniumActions;
  sendKeys(...keys: string[]): SeleniumActions;
  perform(): Promise<void>;
};

export class SeleniumAdapter implements BrowserAdapter {
  readonly name = "selenium";
  readonly capabilities = VISUAL_SURFACE;
  private driver: SeleniumDriver | null = null;
  private origin: unknown = null;
  private keyMap: Record<string, string> = {};
  private readonly options: Required<Pick<AdapterOptions, "headless" | "settleMs">>;
  private readonly browserName: string;

  constructor(options: AdapterOptions & { browser?: string } = {}) {
    this.options = { headless: options.headless ?? true, settleMs: options.settleMs ?? 400 };
    this.browserName = options.browser ?? "chrome";
  }

  async open(url: string, viewport: Viewport): Promise<void> {
    const webdriver = await importSelenium();
    const builder = new webdriver.Builder().forBrowser(this.browserName);
    if (this.options.headless && this.browserName === "chrome") {
      const chrome = await importChromeOptions();
      if (chrome) {
        const chromeOptions = new chrome.Options();
        chromeOptions.addArguments(
          "--headless=new",
          `--window-size=${viewport.width},${viewport.height + 120}`,
        );
        builder.setChromeOptions(chromeOptions);
      }
    }
    this.driver = (await builder.build()) as SeleniumDriver;
    this.origin = webdriver.Origin?.VIEWPORT ?? "viewport";
    const key = (name: string, fallback: string): string => webdriver.Key[name] ?? fallback;
    this.keyMap = {
      Enter: key("ENTER", ""),
      Tab: key("TAB", ""),
      Escape: key("ESCAPE", ""),
      Backspace: key("BACK_SPACE", ""),
      ArrowDown: key("ARROW_DOWN", ""),
      ArrowUp: key("ARROW_UP", ""),
      ArrowLeft: key("ARROW_LEFT", ""),
      ArrowRight: key("ARROW_RIGHT", ""),
      Space: key("SPACE", ""),
    };
    await this.driver.manage().setTimeouts({ pageLoad: 30_000, script: 15_000 });
    await this.driver
      .manage()
      .window()
      .setRect({ width: viewport.width, height: viewport.height + 120 });
    await this.driver.get(url);
    await sleep(this.options.settleMs);
  }

  async snapshot(): Promise<RawSnapshot> {
    const driver = this.requireDriver();
    const dialogs: { text: string; box: null }[] = [];
    // Native alerts block script execution in Selenium: drain them first.
    try {
      const alert = await driver.switchTo().alert();
      dialogs.push({ text: await alert.getText(), box: null });
      await alert.accept();
    } catch {
      /* no alert open */
    }
    // See the identical note on `PlaywrightAdapter.snapshot` — a navigation
    // triggered by the previous action can tear down the execution context
    // `executeScript` runs in. Retrying lets the operator "look again" rather
    // than crashing the session on an ordinary click-then-navigate.
    //
    // The parentheses around the script matter: `PERCEPTION_SCRIPT` is a
    // template literal that starts with a newline, so `return ${...}` would
    // read as `return` immediately followed by a line break — automatic
    // semicolon insertion turns that into a bare `return;`, silently
    // discarding the IIFE's result and handing every caller `null` instead
    // of a percept. Wrapping in `(...)` keeps the parenthesis on the same
    // line as `return`, so ASI never applies.
    const snap = await perceiveAcrossNavigation(
      () => driver.executeScript<RawSnapshot>(`return (${PERCEPTION_SCRIPT})`),
      sleep,
    );
    if (dialogs.length > 0) snap.dialogs = [...snap.dialogs, ...dialogs];
    return snap;
  }

  async screenshot(): Promise<Buffer | null> {
    try {
      const base64 = await this.requireDriver().takeScreenshot();
      return Buffer.from(base64, "base64");
    } catch {
      return null;
    }
  }

  async moveMouse(point: Point): Promise<void> {
    await this.requireDriver()
      .actions({ async: true })
      .move({ x: Math.round(point.x), y: Math.round(point.y), origin: this.origin, duration: 120 })
      .perform();
  }

  async clickAt(point: Point): Promise<void> {
    await this.requireDriver()
      .actions({ async: true })
      .move({ x: Math.round(point.x), y: Math.round(point.y), origin: this.origin, duration: 80 })
      .click()
      .perform();
    await this.settle();
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.requireDriver()
      .actions({ async: true })
      .move({ x: Math.round(point.x), y: Math.round(point.y), origin: this.origin, duration: 80 })
      .doubleClick()
      .perform();
    await this.settle();
  }

  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    const driver = this.requireDriver();
    for (const ch of text) {
      await driver.actions({ async: true }).sendKeys(ch).perform();
      await sleep(perCharIntervalMs);
    }
  }

  async pressKey(key: string): Promise<void> {
    const mapped = this.keyMap[key] ?? key;
    await this.requireDriver().actions({ async: true }).sendKeys(mapped).perform();
    await this.settle();
  }

  async scrollBy(deltaY: number): Promise<void> {
    await this.requireDriver().executeScript(`window.scrollBy(0, ${Math.round(deltaY)});`);
    // A scroll resolves once dispatched, not once the page has scrolled.
    await this.settle();
  }

  async goBack(): Promise<void> {
    // See the identical note on `PlaywrightAdapter.goBack` — there being no
    // history to go back to is not a session-ending error.
    await withTimeout(this.requireDriver().navigate().back(), 15_000).catch(() => {});
    await this.settle();
  }

  async navigate(url: string): Promise<void> {
    await this.requireDriver().get(url);
    await this.settle();
  }

  async close(): Promise<void> {
    await this.driver?.quit().catch(() => {});
    this.driver = null;
  }

  private requireDriver(): SeleniumDriver {
    if (!this.driver) throw new Error("SeleniumAdapter: call open() first");
    return this.driver;
  }

  /**
   * Give an action that may navigate a moment to commit. See the identical
   * note on `PlaywrightAdapter.settle` — every adapter must behave the same
   * or the cognition engine could tell them apart.
   */
  private async settle(): Promise<void> {
    if (this.options.settleMs > 0) await sleep(this.options.settleMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Race a promise against a timeout; selenium-webdriver has no per-call equivalent. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface SeleniumModule {
  Builder: new () => {
    forBrowser(name: string): SeleniumModule["Builder"]["prototype"] & {
      setChromeOptions(opts: unknown): unknown;
      build(): Promise<unknown>;
    };
  };
  Key: Record<string, string>;
  Origin?: { VIEWPORT: unknown };
}

async function importSelenium(): Promise<
  SeleniumModule & {
    Builder: new () => {
      forBrowser(
        name: string,
      ): { setChromeOptions(o: unknown): unknown; build(): Promise<unknown> } & Record<
        string,
        unknown
      >;
    };
  }
> {
  try {
    // Variable specifier: optional peer — must not be resolved at compile time.
    const spec = "selenium-webdriver";
    return (await import(spec)) as never;
  } catch {
    throw new Error(
      'SeleniumAdapter requires the optional peer dependency "selenium-webdriver". Install it with: npm install selenium-webdriver',
    );
  }
}

async function importChromeOptions(): Promise<{
  Options: new () => { addArguments(...args: string[]): void };
} | null> {
  try {
    const spec = "selenium-webdriver/chrome.js";
    return (await import(spec)) as never;
  } catch {
    return null;
  }
}
