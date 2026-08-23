/**
 * Selenium, unlike Playwright/Puppeteer, does not bundle its own browser. By
 * default it either finds whatever `chromedriver` happens to be on PATH
 * (which can be a stale, wrong-version leftover from base-image tooling or
 * another project — a real, opaque failure mode: Selenium warns about the
 * mismatch but uses it anyway) or falls back to Selenium Manager's own
 * auto-detection, which can pair a downloaded/found Chrome with an
 * incompatible driver version if its own cached metadata is stale.
 *
 * Both failure modes were hit in practice getting this test suite running:
 * a version-mismatched pair from a naive PATH-prepend, and (independently)
 * Selenium Manager itself producing a mismatched pair from a stale internal
 * cache. Explicit paths passed straight into `SeleniumAdapter` via
 * `Options.setChromeBinaryPath`/`Builder.setChromeService`
 * (`chromeBinaryPath`/`chromedriverPath`) sidestep both: this resolves a
 * browser+driver pair *guaranteed* to match, from Puppeteer's own bundled
 * Chromium (already a devDependency for its own integration tests, see
 * `puppeteer.integration.test.ts`) plus the `chromedriver` build from the
 * very same Chrome-for-Testing release, fetched via `@puppeteer/browsers`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { Browser, Cache, install } from "@puppeteer/browsers";
import puppeteer from "puppeteer";

export interface SeleniumChromePair {
  readonly chromeBinaryPath: string;
  readonly chromedriverPath: string;
}

/**
 * Puppeteer's own configured cache root. Deriving this by walking `dirname()`
 * up from the resolved executable path looks appealing but is wrong on
 * macOS: Chrome for Testing's `.app/Contents/MacOS/...` bundle nests one
 * level deeper there than on Linux/Windows, so a fixed dirname-count lands
 * inside the browser's own archive directory instead of the cache root.
 * `puppeteer.configuration()` reports the real cache directory Puppeteer
 * itself used (`PUPPETEER_CACHE_DIR`, a `.puppeteerrc.js` override, or the
 * `~/.cache/puppeteer` default) regardless of platform-specific path shape.
 */
async function cacheDir(): Promise<string> {
  const config = await puppeteer.configuration();
  return config.cacheDirectory ?? join(homedir(), ".cache", "puppeteer");
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
 * Resolve (downloading the matching chromedriver if not already cached) a
 * Chrome + chromedriver pair guaranteed to be version-compatible. Memoized:
 * the whole test file shares one pair across its tests.
 */
export function prepareSeleniumChromePair(): Promise<SeleniumChromePair> {
  cached ??= (async () => {
    const chromeBinaryPath = await puppeteer.executablePath();
    const resolvedCacheDir = await cacheDir();
    const buildId = buildIdFor(resolvedCacheDir, chromeBinaryPath);

    const { executablePath: chromedriverPath } = await install({
      browser: Browser.CHROMEDRIVER,
      buildId,
      cacheDir: resolvedCacheDir,
    });

    return { chromeBinaryPath, chromedriverPath };
  })();
  return cached;
}
