export type { BrowserAdapter, RawSnapshot, AdapterOptions } from "./adapter.js";
export { PlaywrightAdapter } from "./playwright.js";
export { PuppeteerAdapter } from "./puppeteer.js";
export { SeleniumAdapter } from "./selenium.js";
export { MockAdapter, DEMO_APP } from "./mock.js";
export type { MockAppSpec, MockScreenSpec, MockElementSpec } from "./mock.js";
export { planClick, planTyping, hesitationMs } from "./humanizer.js";
export type { Gesture, TypingPlan } from "./humanizer.js";
export { PERCEPTION_SCRIPT } from "./perceptionScript.js";

import type { AdapterOptions, BrowserAdapter } from "./adapter.js";
import { MockAdapter } from "./mock.js";
import { PlaywrightAdapter } from "./playwright.js";
import { PuppeteerAdapter } from "./puppeteer.js";
import { SeleniumAdapter } from "./selenium.js";

export type AdapterName = "playwright" | "puppeteer" | "selenium" | "mock";

/** Factory used by the CLI and config loader. */
export function createAdapter(name: AdapterName, options: AdapterOptions = {}): BrowserAdapter {
  switch (name) {
    case "playwright":
      return new PlaywrightAdapter(options);
    case "puppeteer":
      return new PuppeteerAdapter(options);
    case "selenium":
      return new SeleniumAdapter(options);
    case "mock":
      return new MockAdapter();
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown adapter "${String(exhaustive)}"`);
    }
  }
}
