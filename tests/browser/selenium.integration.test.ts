/**
 * Real-browser integration test for the adapter contract.
 *
 * Mirrors `tests/browser/playwright.integration.test.ts` — same fixture
 * site, same assertions — because `SeleniumAdapter` is meant to be
 * indistinguishable from the other adapters to the cognition engine, and is
 * typed against hand-written duck types for `selenium-webdriver`'s API that
 * only a real browser can catch drifting out from under.
 *
 * It also specifically exercises the navigation-retry fix: clicking a link
 * that navigates, then immediately perceiving again, must not throw even
 * though `snapshot()`'s `executeScript` can race the navigation tearing down
 * its execution context (`src/browser/navigationRetry.ts`).
 *
 * See `seleniumChromeSetup.ts` for why the browser+driver pair is resolved
 * explicitly rather than left to whatever happens to be on the host's PATH.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SeleniumAdapter } from "../../src/browser/selenium.js";
import { EveSession } from "../../src/engine/session.js";
import { type StaticSite, startStaticSite } from "../fixtures/staticSite.js";
import { prepareSeleniumChromePair } from "./seleniumChromeSetup.js";

const VIEWPORT = { width: 1280, height: 800 };

let site: StaticSite;
let restorePath: string;

beforeAll(async () => {
  site = await startStaticSite();
  const { binDir } = await prepareSeleniumChromePair();
  restorePath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}:${restorePath}`;
}, 120_000);

afterAll(async () => {
  await site?.close();
  if (restorePath !== undefined) process.env.PATH = restorePath;
});

describe("SeleniumAdapter against a real browser", () => {
  it("perceives a rendered page the way the contract promises", async () => {
    const adapter = new SeleniumAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);
      const snap = await adapter.snapshot();

      expect(snap.title).toBe("Acme — Home");
      expect(snap.url).toContain("127.0.0.1");
      expect(snap.scrollY).toBe(0);
      expect(Array.isArray(snap.elements)).toBe(true);
      expect(snap.elements.length).toBeGreaterThan(0);

      const cta = snap.elements.find((el) => el.role === "link" && el.text.includes("Sign up"));
      expect(cta, "perception script found no 'Sign up' link").toBeDefined();
      expect(cta?.interactive).toBe(true);
      expect(cta?.box.width).toBeGreaterThan(0);
      expect(cta?.box.height).toBeGreaterThan(0);
      expect(cta!.box.width).toBeLessThan(VIEWPORT.width / 2);

      const disabled = snap.elements.find(
        (el) => el.role === "button" && el.text.includes("Coming soon"),
      );
      expect(disabled, "perception script found no 'Coming soon' button").toBeDefined();
      expect(disabled?.disabled).toBe(true);

      const leaked = JSON.stringify(snap);
      expect(leaked).not.toContain("addEventListener");
      expect(leaked).not.toContain("<script");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("survives a click-triggered navigation immediately followed by a snapshot", async () => {
    // The exact race `perceiveAcrossNavigation` exists to protect against
    // (item 1): a click that navigates, then perceiving right away with no
    // extra wait beyond the adapter's own settle — must not throw.
    const adapter = new SeleniumAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);
      const home = await adapter.snapshot();
      const cta = home.elements.find((el) => el.role === "link" && el.text.includes("Sign up"));
      expect(cta).toBeDefined();

      await adapter.clickAt({
        x: cta!.box.x + cta!.box.width / 2,
        y: cta!.box.y + cta!.box.height / 2,
      });
      const signup = await adapter.snapshot();

      expect(signup.url).toContain("/signup");
      expect(signup.title).toBe("Acme — Sign up");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("actuates: clicking, typing, scrolling, history and native dialogs", async () => {
    const adapter = new SeleniumAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);

      const home = await adapter.snapshot();
      const cta = home.elements.find((el) => el.role === "link" && el.text.includes("Sign up"));
      expect(cta).toBeDefined();
      await adapter.moveMouse({
        x: cta!.box.x + cta!.box.width / 2,
        y: cta!.box.y + cta!.box.height / 2,
      });
      await adapter.clickAt({
        x: cta!.box.x + cta!.box.width / 2,
        y: cta!.box.y + cta!.box.height / 2,
      });
      const signup = await adapter.snapshot();
      expect(signup.url).toContain("/signup");
      expect(signup.title).toBe("Acme — Sign up");

      const email = signup.elements.find((el) => el.editable);
      expect(email, "no editable element perceived on the signup page").toBeDefined();
      await adapter.clickAt({
        x: email!.box.x + email!.box.width / 2,
        y: email!.box.y + email!.box.height / 2,
      });
      await adapter.typeText("ada@example.com", 1);
      const typed = await adapter.snapshot();
      expect(JSON.stringify(typed.elements)).toContain("ada@example.com");

      await adapter.scrollBy(600);
      const scrolled = await adapter.snapshot();
      expect(scrolled.scrollY).toBeGreaterThan(0);
      expect(scrolled.scrollHeight).toBeGreaterThan(VIEWPORT.height);
      await adapter.scrollBy(-600);

      const submit = (await adapter.snapshot()).elements.find(
        (el) => el.role === "button" && el.text.includes("Create account"),
      );
      expect(submit).toBeDefined();
      await adapter.clickAt({
        x: submit!.box.x + submit!.box.width / 2,
        y: submit!.box.y + submit!.box.height / 2,
      });
      const afterSubmit = await adapter.snapshot();
      expect(afterSubmit.dialogs.some((d) => d.text.includes("Create this account?"))).toBe(true);

      await adapter.pressKey("Escape");

      await adapter.goBack();
      const back = await adapter.snapshot();
      expect(back.title).toBe("Acme — Home");

      await adapter.navigate(`${site.origin}/signup`);
      expect((await adapter.snapshot()).url).toContain("/signup");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("captures a real PNG screenshot", async () => {
    const adapter = new SeleniumAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);
      const png = await adapter.screenshot();
      expect(png).toBeInstanceOf(Buffer);
      expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("runs a full session end to end through a real browser", async () => {
    const adapter = new SeleniumAdapter({ headless: true });
    const result = await new EveSession({
      adapter,
      startUrl: site.origin,
      persona: "first-time-user",
      goal: "Create an account",
      seed: 42,
      maxSteps: 12,
      viewport: VIEWPORT,
      paceScale: 0,
    }).run();

    expect(result.error).toBeNull();
    expect(result.usage.steps).toBeGreaterThan(0);
    expect(result.iterations.length).toBeGreaterThan(0);
    expect(result.emotionTimeline.length).toBeGreaterThan(0);

    expect(result.scores.length).toBeGreaterThan(0);
    for (const score of result.scores) {
      expect(Number.isFinite(score.value)).toBe(true);
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
    }

    const urls = new Set(result.capturedScreens.map((screen) => screen.url));
    expect(urls.size).toBeGreaterThan(1);
  }, 180_000);
});
