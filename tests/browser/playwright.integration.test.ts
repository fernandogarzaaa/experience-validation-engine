/**
 * Real-browser integration test for the adapter contract.
 *
 * The offline suite deliberately never touches a browser or the network, and
 * that constraint stays intact: this file lives outside `tests/**` and only
 * runs under `npm run test:browser`.
 *
 * It exists because `PlaywrightAdapter` is typed against hand-written duck
 * types for Playwright's `Page`, so `tsc` cannot notice if the real API drifts
 * out from under it. Nothing but actually driving Chromium catches that. The
 * same reasoning covers the perception script, which is a plain string and is
 * therefore never type-checked at all.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightAdapter } from "../../src/browser/playwright.js";
import { EveSession } from "../../src/engine/session.js";
import { type StaticSite, startStaticSite } from "../fixtures/staticSite.js";

const VIEWPORT = { width: 1280, height: 800 };

let site: StaticSite;

beforeAll(async () => {
  site = await startStaticSite();
});

afterAll(async () => {
  await site?.close();
});

describe("PlaywrightAdapter against a real browser", () => {
  it("perceives a rendered page the way the contract promises", async () => {
    const adapter = new PlaywrightAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);
      const snap = await adapter.snapshot();

      expect(snap.title).toBe("Acme — Home");
      expect(snap.url).toContain("127.0.0.1");
      expect(snap.viewport).toEqual(VIEWPORT);
      expect(snap.scrollY).toBe(0);
      expect(Array.isArray(snap.elements)).toBe(true);
      expect(snap.elements.length).toBeGreaterThan(0);

      // The perception script must find the call to action and read it as a link.
      // Match on role as well as text: the surrounding <p> carries the same
      // text, and a human distinguishes the two by how they look.
      const cta = snap.elements.find((el) => el.role === "link" && el.text.includes("Sign up"));
      expect(cta, "perception script found no 'Sign up' link").toBeDefined();
      expect(cta?.interactive).toBe(true);
      expect(cta?.box.width).toBeGreaterThan(0);
      expect(cta?.box.height).toBeGreaterThan(0);
      // The link's box must be the link, not the full-width paragraph holding it.
      expect(cta!.box.width).toBeLessThan(VIEWPORT.width / 2);

      // A visually disabled control must be reported as disabled, not merely present.
      const disabled = snap.elements.find(
        (el) => el.role === "button" && el.text.includes("Coming soon"),
      );
      expect(disabled, "perception script found no 'Coming soon' button").toBeDefined();
      expect(disabled?.disabled).toBe(true);

      // Prime directive: a percept must not leak anything a human cannot see.
      const leaked = JSON.stringify(snap);
      expect(leaked).not.toContain("addEventListener");
      expect(leaked).not.toContain("<script");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("actuates: clicking, typing, scrolling, history and native dialogs", async () => {
    const adapter = new PlaywrightAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);

      // Click the CTA at its perceived centre and confirm the browser navigated.
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

      // Typing into a focused field must show up as visible text.
      const email = signup.elements.find((el) => el.editable);
      expect(email, "no editable element perceived on the signup page").toBeDefined();
      await adapter.clickAt({
        x: email!.box.x + email!.box.width / 2,
        y: email!.box.y + email!.box.height / 2,
      });
      await adapter.typeText("ada@example.com", 1);
      const typed = await adapter.snapshot();
      expect(JSON.stringify(typed.elements)).toContain("ada@example.com");

      // Scrolling must move the viewport.
      await adapter.scrollBy(600);
      const scrolled = await adapter.snapshot();
      expect(scrolled.scrollY).toBeGreaterThan(0);
      expect(scrolled.scrollHeight).toBeGreaterThan(VIEWPORT.height);
      await adapter.scrollBy(-600);

      // The submit button raises a native confirm(); the adapter must accept it
      // and surface the message as a dialog on the next percept.
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

      // pressKey must reach the page without throwing.
      await adapter.pressKey("Escape");

      // Back button returns to the previous page.
      await adapter.goBack();
      const back = await adapter.snapshot();
      expect(back.title).toBe("Acme — Home");

      // Direct navigation works too.
      await adapter.navigate(`${site.origin}/signup`);
      expect((await adapter.snapshot()).url).toContain("/signup");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("captures a real PNG screenshot", async () => {
    const adapter = new PlaywrightAdapter({ headless: true });
    try {
      await adapter.open(site.origin, VIEWPORT);
      const png = await adapter.screenshot();
      expect(png).toBeInstanceOf(Buffer);
      // PNG magic number — proves we got image bytes, not an error object.
      expect(png?.subarray(0, 4).toString("hex")).toBe("89504e47");
    } finally {
      await adapter.close();
    }
  }, 120_000);

  it("runs a full session end to end through a real browser", async () => {
    const adapter = new PlaywrightAdapter({ headless: true });
    const result = await new EveSession({
      adapter,
      startUrl: site.origin,
      persona: "first-time-user",
      goal: "Create an account",
      seed: 42,
      maxSteps: 12,
      viewport: VIEWPORT,
      // Real-time human pauses would make CI crawl; the simulated clock is
      // unaffected, so the cognitive result is identical.
      paceScale: 0,
    }).run();

    expect(result.usage.steps).toBeGreaterThan(0);
    expect(result.iterations.length).toBeGreaterThan(0);
    expect(result.emotionTimeline.length).toBeGreaterThan(0);

    // Every scored dimension must carry a real number and its evidence.
    expect(result.scores.length).toBeGreaterThan(0);
    for (const score of result.scores) {
      expect(Number.isFinite(score.value)).toBe(true);
      expect(score.value).toBeGreaterThanOrEqual(0);
      expect(score.value).toBeLessThanOrEqual(100);
    }

    // Driving a real browser must actually move: the operator should have left
    // the landing page rather than sitting on it for every step.
    const urls = new Set(result.capturedScreens.map((screen) => screen.url));
    expect(urls.size).toBeGreaterThan(1);
  }, 180_000);
});
