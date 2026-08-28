import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { isOptionalTransport, renderDoctor, type SurfaceReport } from "../src/browser/doctor.js";
import {
  DriverLoadError,
  DriverMissingError,
  importDriver,
  isMissingBrowserBinary,
} from "../src/browser/driverLoader.js";

const scratch = mkdtempSync(join(tmpdir(), "eve-driver-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Write a module to disk and return the specifier `import()` will accept. */
function moduleWith(name: string, source: string): string {
  const file = join(scratch, name);
  writeFileSync(file, source);
  return pathToFileURL(file).href;
}

describe("importDriver", () => {
  it("reports an absent driver as missing, with the install command", async () => {
    await expect(
      importDriver("eve-no-such-driver-exists", "npm install eve-no-such-driver-exists"),
    ).rejects.toBeInstanceOf(DriverMissingError);

    const error = await importDriver("eve-no-such-driver-exists", "npm install it").catch(
      (e) => e as DriverMissingError,
    );
    expect(error.installCommand).toBe("npm install it");
    expect(error.message).toContain("npm install it");
  });

  /**
   * Telling someone whose Playwright is missing to "use the bundled Playwright
   * adapter instead" is advice they cannot follow.
   */
  it("does not offer the missing driver as its own fallback", async () => {
    const playwright = new DriverMissingError("playwright", "npm install playwright");
    expect(playwright.message).not.toContain("--browser playwright");
    expect(playwright.message).toContain("ships with EVE");

    const puppeteer = new DriverMissingError("puppeteer", "npm install puppeteer");
    expect(puppeteer.message).toContain("--browser playwright");
    // And it must not claim Playwright needs nothing further: the package
    // ships with EVE, the browser binaries do not.
    expect(puppeteer.message).not.toContain("needs no extra install");
    expect(puppeteer.message).toContain("eve doctor");
  });

  it("loads a driver that resolves", async () => {
    const spec = moduleWith("ok.mjs", "export const chromium = { launch: () => {} };\n");
    const mod = (await importDriver(spec, "unused")) as { chromium: unknown };
    expect(mod.chromium).toBeDefined();
  });

  /**
   * The bug this class exists to prevent. Node reports a module missing
   * *inside* the driver with the same error code as a missing driver, so
   * classifying on the code alone told users to reinstall a package they
   * already had, while the actual broken dependency went unmentioned.
   */
  it("does not report a driver as missing when one of its own imports is", async () => {
    const spec = moduleWith(
      "broken-dep.mjs",
      "import 'some-package-the-driver-needs-that-is-absent';\nexport const chromium = {};\n",
    );

    const error = await importDriver(spec, "npm install driver").catch((e) => e as Error);

    expect(error).toBeInstanceOf(DriverLoadError);
    expect(error).not.toBeInstanceOf(DriverMissingError);
    // It must name the real culprit rather than the driver.
    expect(error.message).toContain("some-package-the-driver-needs-that-is-absent");
    // And it must not send the user to reinstall what is already there.
    expect(error.message).toContain("reinstalling it is unlikely to help");
  });

  it("reports a driver that throws while loading as a load failure", async () => {
    const spec = moduleWith("throws.mjs", "throw new Error('driver blew up at import');\n");

    const error = await importDriver(spec, "npm install driver").catch((e) => e as Error);

    expect(error).toBeInstanceOf(DriverLoadError);
    expect(error.message).toContain("driver blew up at import");
  });
});

describe("isMissingBrowserBinary", () => {
  it("recognises Playwright's missing-executable failure", () => {
    expect(
      isMissingBrowserBinary(
        new Error(
          "browserType.launch: Executable doesn't exist at /opt/pw/chromium/headless_shell",
        ),
      ),
    ).toBe(true);
  });

  it("recognises Puppeteer's missing-browser failure", () => {
    // Puppeteer never says "launch" for this case, so the old broad match
    // missed the one message it most needed to catch.
    expect(isMissingBrowserBinary(new Error("Could not find Chrome (ver. 119.0.6045.105)"))).toBe(
      true,
    );
    expect(
      isMissingBrowserBinary(new Error("Browser was not found at the configured executablePath")),
    ).toBe(true);
  });

  it("recognises Selenium's missing driver", () => {
    expect(
      isMissingBrowserBinary(
        new Error("The chromedriver executable needs to be available in PATH"),
      ),
    ).toBe(true);
  });

  /**
   * The classification decides what a user is told to do, and these are the
   * cases where getting it wrong wastes their time. A browser that is present
   * but cannot start — no permission, a missing system library, an OOM kill —
   * is not fixed by installing a browser, and an earlier version of this
   * matched every one of them on the words "Failed to launch".
   */
  it("does not mistake an installed-but-unable-to-start browser for a missing one", () => {
    for (const message of [
      "Failed to launch the browser process: Code 1",
      "Failed to launch chrome! spawn EACCES",
      "Failed to launch the browser process! error while loading shared libraries: libnss3.so",
      "Target closed",
      "net::ERR_CONNECTION_REFUSED",
    ]) {
      expect(isMissingBrowserBinary(new Error(message))).toBe(false);
    }
  });
});

describe("renderDoctor", () => {
  const reports: readonly SurfaceReport[] = [
    { surface: "mock", status: "ready", provides: "The built-in demo app." },
    {
      surface: "playwright",
      status: "needs-setup",
      provides: "Web apps in a real browser.",
      remedy: "npx playwright install chromium",
      detail: "Executable doesn't exist",
    },
  ];

  it("shows each surface, its state, and how to fix what is not ready", () => {
    const out = renderDoctor(reports);
    expect(out).toContain("✓ mock");
    expect(out).toContain("! playwright");
    expect(out).toContain("Fix: npx playwright install chromium");
    expect(out).toContain("Executable doesn't exist");
  });

  it("says so plainly when everything works", () => {
    const out = renderDoctor([reports[0] as SurfaceReport]);
    expect(out).toContain("Nothing needs setup.");
  });

  /**
   * `Math.max()` over an empty array is -Infinity, and `" ".repeat` of that
   * throws — a crash in the command someone runs precisely when things are
   * already going wrong.
   */
  it("does not crash on an empty report", () => {
    expect(() => renderDoctor([])).not.toThrow();
    expect(renderDoctor([])).toContain("No surfaces to check.");
  });

  /**
   * "Ready" is a promise the preflight has to be able to keep. Selenium needs
   * a browser and a matching driver on PATH that only appear when a session
   * builds the WebDriver, so a successful package import is not evidence the
   * surface works.
   */
  it("marks a surface it cannot confirm as unverified, not ready", () => {
    const out = renderDoctor([
      {
        surface: "selenium",
        status: "unverified",
        provides: "Web apps via Selenium.",
        detail: "The package is installed.",
      },
    ]);
    expect(out).toContain("? selenium");
    expect(out).not.toContain("✓ selenium");
    // Unverified is not blocked: it must not be counted as needing setup.
    expect(out).toContain("Nothing needs setup.");
  });

  it("counts lost capability separately from unused transports", () => {
    const out = renderDoctor([
      { surface: "playwright", status: "needs-setup", provides: "browser", remedy: "install" },
      { surface: "puppeteer", status: "broken", provides: "browser", detail: "launch failed" },
    ]);
    expect(out).toContain("1 surface(s) need setup.");
    expect(out).toContain("1 alternative transport(s) unavailable");
  });

  /**
   * Puppeteer and Selenium are alternative transports for a modality
   * Playwright already covers, so their absence costs no capability. Saying
   * "1 surface needs setup" would send someone to install ~200MB that buys
   * them nothing.
   */
  it("does not treat a missing alternative transport as lost capability", () => {
    const out = renderDoctor([
      { surface: "mock", status: "ready", provides: "demo" },
      { surface: "playwright", status: "ready", provides: "browser" },
      { surface: "puppeteer", status: "needs-setup", provides: "browser", remedy: "npm i" },
    ]);
    expect(out).toContain("Nothing is lost");
    expect(out).not.toContain("surface(s) need setup");
    expect(isOptionalTransport("puppeteer")).toBe(true);
    expect(isOptionalTransport("selenium")).toBe(true);
    expect(isOptionalTransport("playwright")).toBe(false);
  });

  it("aligns continuation lines under the description column", () => {
    const lines = renderDoctor(reports).split("\n");
    const header = lines.find((l) => l.includes("! playwright")) as string;
    const detail = lines.find((l) => l.trim().startsWith("Executable")) as string;
    expect(detail.indexOf("Executable")).toBe(header.indexOf("Web apps"));
  });
});
