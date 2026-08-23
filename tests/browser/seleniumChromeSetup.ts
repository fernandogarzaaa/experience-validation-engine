/**
 * Selenium, unlike Playwright/Puppeteer, does not bundle its own browser —
 * it drives whatever Chrome-family binary and matching `chromedriver` it
 * finds (Selenium Manager's normal discovery: PATH, then well-known install
 * locations). A stale `chromedriver` already on a host's PATH is a real
 * failure mode: Selenium Manager warns but still uses it, and a
 * version-mismatched pair fails every session with a fairly opaque error.
 *
 * Rather than depend on whatever the host happens to already have on PATH,
 * this resolves a browser+driver pair *guaranteed* to match: Puppeteer's own
 * bundled Chromium (already a devDependency for its own integration tests,
 * see `puppeteer.integration.test.ts`) plus the `chromedriver` build from
 * the very same Chrome-for-Testing release, fetched via `@puppeteer/browsers`
 * (a transitive dependency of `puppeteer`, and — for resolution stability —
 * also a direct devDependency here). Both ends are then exposed on `PATH`
 * under the names Selenium's default `chrome` browser discovery looks for,
 * so `SeleniumAdapter` itself needs no special-casing for tests: the exact
 * same `new SeleniumAdapter({ headless: true })` a real user writes is what
 * gets exercised.
 */

import { mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Browser, Cache, install } from "@puppeteer/browsers";
import puppeteer from "puppeteer";

export interface SeleniumChromePair {
  readonly chromePath: string;
  readonly chromedriverPath: string;
  /** Directory holding `google-chrome`/`chromedriver` symlinks; prepend to PATH. */
  readonly binDir: string;
}

/** Puppeteer's cache root, derived from its own resolved executable path. */
function cacheDirFor(chromeExecutablePath: string): string {
  // <cacheDir>/chrome/<platform>-<buildId>/<archive>/<binary>
  return dirname(dirname(dirname(dirname(chromeExecutablePath))));
}

function buildIdFor(cacheDir: string, chromeExecutablePath: string): string {
  const cache = new Cache(cacheDir);
  const chrome = cache
    .getInstalledBrowsers()
    .find((b) => b.browser === "chrome" && b.executablePath === chromeExecutablePath);
  if (!chrome) {
    throw new Error(
      `prepareSeleniumChromePair: puppeteer reports its Chrome at "${chromeExecutablePath}" but ` +
        `@puppeteer/browsers' cache at "${cacheDir}" has no matching installed browser entry.`,
    );
  }
  return chrome.buildId;
}

let cached: Promise<SeleniumChromePair> | null = null;

/**
 * Resolve (downloading the matching chromedriver if not already cached) and
 * expose on PATH a Chrome + chromedriver pair guaranteed to be compatible.
 * Memoized: the whole test file shares one pair across its tests.
 */
export function prepareSeleniumChromePair(): Promise<SeleniumChromePair> {
  cached ??= (async () => {
    const chromePath = await puppeteer.executablePath();
    const cacheDir = cacheDirFor(chromePath);
    const buildId = buildIdFor(cacheDir, chromePath);

    const { executablePath: chromedriverPath } = await install({
      browser: Browser.CHROMEDRIVER,
      buildId,
      cacheDir,
    });

    const binDir = await mkdtemp(join(tmpdir(), "eve-selenium-bin-"));
    const chromeLink = join(binDir, "google-chrome");
    const driverLink = join(binDir, "chromedriver");
    await symlink(chromePath, chromeLink);
    await symlink(chromedriverPath, driverLink);

    return { chromePath, chromedriverPath, binDir };
  })();
  return cached;
}
