import type { Point, Viewport } from "../core/types.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";
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
  private driver: SeleniumDriver | null = null;
  private origin: unknown = null;
  private keyMap: Record<string, string> = {};
  private readonly options: Required<AdapterOptions>;
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
        chromeOptions.addArguments("--headless=new", `--window-size=${viewport.width},${viewport.height + 120}`);
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
    await this.driver.manage().window().setRect({ width: viewport.width, height: viewport.height + 120 });
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
    const snap = await driver.executeScript<RawSnapshot>(`return ${PERCEPTION_SCRIPT}`);
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
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.requireDriver()
      .actions({ async: true })
      .move({ x: Math.round(point.x), y: Math.round(point.y), origin: this.origin, duration: 80 })
      .doubleClick()
      .perform();
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
  }

  async scrollBy(deltaY: number): Promise<void> {
    await this.requireDriver().executeScript(`window.scrollBy(0, ${Math.round(deltaY)});`);
  }

  async goBack(): Promise<void> {
    await this.requireDriver().navigate().back();
  }

  async navigate(url: string): Promise<void> {
    await this.requireDriver().get(url);
  }

  async close(): Promise<void> {
    await this.driver?.quit().catch(() => {});
    this.driver = null;
  }

  private requireDriver(): SeleniumDriver {
    if (!this.driver) throw new Error("SeleniumAdapter: call open() first");
    return this.driver;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function importSelenium(): Promise<SeleniumModule & { Builder: new () => { forBrowser(name: string): { setChromeOptions(o: unknown): unknown; build(): Promise<unknown> } & Record<string, unknown> } }> {
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

async function importChromeOptions(): Promise<{ Options: new () => { addArguments(...args: string[]): void } } | null> {
  try {
    const spec = "selenium-webdriver/chrome.js";
    return (await import(spec)) as never;
  } catch {
    return null;
  }
}
