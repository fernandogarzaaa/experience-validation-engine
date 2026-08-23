/**
 * Surviving navigation while perceiving.
 *
 * The perception script runs inside the page, so a navigation destroys the
 * execution context it is running in. When a click follows a link, the very
 * next percept can land in that window and the driver throws instead of
 * returning a screen — which, without this, aborts the whole session.
 *
 * A human in that position does not crash: they notice the page is changing,
 * wait for it, and look again. That is exactly what this does.
 */

/** Driver errors that mean "the page navigated under you", not "the browser broke". */
const NAVIGATION_TEARDOWN_PATTERNS = [
  // Playwright and Puppeteer, CDP-backed.
  "execution context was destroyed",
  "cannot find context with specified id",
  "execution context is not available in detached frame",
  // Frame swapped out mid-evaluate.
  "frame was detached",
  "frame got detached",
  "navigating and changing the document",
  // Selenium (ChromeDriver/GeckoDriver): executeScript racing a navigation.
  "document unloaded while waiting for result",
  "browsing context has been discarded",
];

/** True when the failure is a page navigation rather than a dead browser. */
export function isNavigationTeardown(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  // A closed target or browser is fatal: retrying only delays the real error.
  if (message.includes("target closed") || message.includes("browser has been closed")) {
    return false;
  }
  return NAVIGATION_TEARDOWN_PATTERNS.some((pattern) => message.includes(pattern));
}

export interface PerceiveRetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base pause between attempts; grows linearly so a slow page still lands. */
  backoffMs?: number;
}

/**
 * Run a perception attempt, retrying only when the page navigated mid-flight.
 * Any other error propagates untouched — a broken adapter must stay loud.
 */
export async function perceiveAcrossNavigation<T>(
  perceive: () => Promise<T>,
  wait: (ms: number) => Promise<void>,
  options: PerceiveRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 4;
  const backoffMs = options.backoffMs ?? 150;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await perceive();
    } catch (error) {
      if (!isNavigationTeardown(error)) throw error;
      lastError = error;
      if (attempt < attempts) await wait(backoffMs * attempt);
    }
  }
  throw lastError;
}
