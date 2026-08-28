/**
 * Surface preflight — which of EVE's surfaces actually work here.
 *
 * EVE spans four modalities, and only the visual one depends on anything
 * outside the package. The failure that motivated this check is specific:
 * the driver imports fine, and the browser binaries it wants are absent, so
 * the run dies at `launch()` several seconds in, mid-session, with an error
 * about an executable path. That is a setup problem wearing a runtime
 * problem's clothes, and it should be answerable before a session starts.
 *
 * Nothing here is a session. Each probe loads a driver and, where a driver
 * needs more than itself, launches and immediately closes a browser.
 */

import { DriverMissingError, importDriver, isMissingBrowserBinary } from "./driverLoader.js";

/**
 * `unverified` is the honest answer for a surface EVE cannot fully check
 * without doing the very thing a preflight must not do — start a real
 * session. Reporting such a surface as `ready` would be a promise it cannot
 * keep; reporting it as `needs-setup` would send people to fix what may well
 * be fine.
 */
export type SurfaceStatus = "ready" | "unverified" | "needs-setup" | "broken";

/**
 * Surfaces that are alternative transports for a modality Playwright already
 * covers. Their absence costs no capability, so it must neither read as a
 * lost surface nor fail a preflight.
 */
const OPTIONAL_TRANSPORTS = new Set(["puppeteer", "selenium"]);

/** True when a surface's absence costs the user no capability. */
export function isOptionalTransport(surface: string): boolean {
  return OPTIONAL_TRANSPORTS.has(surface);
}

export interface SurfaceReport {
  /** The adapter name, as `--browser` accepts it. */
  readonly surface: string;
  readonly status: SurfaceStatus;
  /** What EVE can do with this surface, in the user's terms. */
  readonly provides: string;
  /** Present when status is not "ready": what to run to fix it. */
  readonly remedy?: string;
  /** Present when status is not "ready": what actually went wrong. */
  readonly detail?: string;
}

/** Surfaces that are part of the package and cannot fail to be available. */
const BUILT_IN: readonly SurfaceReport[] = [
  {
    surface: "mock",
    status: "ready",
    provides: "The built-in offline demo app — no network, no browser.",
  },
  {
    surface: "read",
    status: "ready",
    provides: "Documents, decks, analytics, transcripts, payloads (the document surface).",
  },
  {
    surface: "chat",
    status: "ready",
    provides: "Support bots, copilots, scripted flows (the conversational surface).",
  },
  {
    surface: "mcp-eval",
    status: "ready",
    provides: "MCP servers as a tool-calling surface.",
  },
];

/**
 * Probe a browser driver.
 *
 * `launch` is attempted only when the import succeeds, because a missing
 * package and missing browser binaries are different problems with different
 * fixes, and running them together would report whichever failed first.
 */
async function probeBrowser(
  surface: string,
  spec: string,
  installCommand: string,
  binaryCommand: string,
  provides: string,
  launch: (mod: unknown) => Promise<{ close(): Promise<void> }>,
): Promise<SurfaceReport> {
  let mod: unknown;
  try {
    mod = await importDriver(spec, installCommand);
  } catch (error) {
    const missing = error instanceof DriverMissingError;
    return {
      surface,
      status: missing ? "needs-setup" : "broken",
      provides,
      remedy: missing ? installCommand : undefined,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }

  try {
    const browser = await launch(mod);
    await browser.close();
    return { surface, status: "ready", provides };
  } catch (error) {
    const noBinary = isMissingBrowserBinary(error);
    return {
      surface,
      status: noBinary ? "needs-setup" : "broken",
      provides,
      remedy: noBinary ? binaryCommand : undefined,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }
}

type Launchable = { chromium: { launch(o: { headless: boolean }): Promise<Launched> } };
type Launched = { close(): Promise<void> };

/** Check every surface EVE can run, in parallel. */
export async function diagnoseSurfaces(): Promise<readonly SurfaceReport[]> {
  const browsers = await Promise.all([
    probeBrowser(
      "playwright",
      "playwright",
      "npm install playwright",
      "npx playwright install chromium",
      "Web apps in a real browser (bundled — EVE's reference visual surface).",
      async (mod) => (mod as Launchable).chromium.launch({ headless: true }),
    ),
    probeBrowser(
      "puppeteer",
      "puppeteer",
      "npm install puppeteer",
      "npx puppeteer browsers install chrome",
      "Web apps via Puppeteer. Same capability as Playwright, different transport.",
      async (mod) => {
        const m = mod as { default?: unknown };
        const pptr = (m.default ?? m) as { launch(o: { headless: boolean }): Promise<Launched> };
        return pptr.launch({ headless: true });
      },
    ),
  ]);

  // Selenium needs a browser *and* a matching driver binary on PATH, neither
  // of which it can install, and neither of which exists until `Builder.build()`
  // runs inside a real session. Importing the package is the only part EVE can
  // honestly check here — so the result is `unverified`, not `ready`. The
  // previous code said exactly this in a comment and then returned `ready`
  // anyway, which is the promise the comment warned against.
  let selenium: SurfaceReport;
  try {
    await importDriver("selenium-webdriver", "npm install selenium-webdriver");
    selenium = {
      surface: "selenium",
      status: "unverified",
      provides: "Web apps via Selenium. Same capability as Playwright, different transport.",
      detail:
        "The package is installed. EVE cannot confirm the surface works without starting a session: Selenium also needs a browser and a matching driver on PATH.",
    };
  } catch (error) {
    selenium = {
      surface: "selenium",
      status: error instanceof DriverMissingError ? "needs-setup" : "broken",
      provides: "Web apps via Selenium. Same capability as Playwright, different transport.",
      remedy: error instanceof DriverMissingError ? "npm install selenium-webdriver" : undefined,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  }

  return [...BUILT_IN, ...browsers, selenium];
}

/** Render the preflight for a terminal. */
export function renderDoctor(reports: readonly SurfaceReport[]): string {
  // `Math.max()` over nothing is -Infinity, and `" ".repeat(-Infinity)` throws
  // a RangeError — a crash in the very command someone runs when things are
  // already going wrong.
  if (reports.length === 0) return "EVE surface check\n\n  No surfaces to check.\n";

  const mark = (s: SurfaceStatus) =>
    s === "ready" ? "✓" : s === "unverified" ? "?" : s === "needs-setup" ? "!" : "✗";
  const width = Math.max(...reports.map((r) => r.surface.length));
  // "  " + mark + " " + padded surface + "  " — continuation lines sit under `provides`.
  const indent = " ".repeat(width + 6);
  const lines = ["EVE surface check", ""];

  for (const r of reports) {
    lines.push(`  ${mark(r.status)} ${r.surface.padEnd(width)}  ${r.provides}`);
    if (r.detail) lines.push(`${indent}${r.detail}`);
    if (r.remedy) lines.push(`${indent}Fix: ${r.remedy}`);
  }

  // Counted separately, because they mean different things to the reader: one
  // is capability they do not have, the other is a transport they do not need.
  const blocked = reports.filter((r) => r.status === "needs-setup" || r.status === "broken");
  const lostCapability = blocked.filter((r) => !isOptionalTransport(r.surface));
  const unusedTransports = blocked.filter((r) => isOptionalTransport(r.surface));

  lines.push("");
  if (lostCapability.length > 0) {
    lines.push(`  ${lostCapability.length} surface(s) need setup.`);
  }
  if (unusedTransports.length > 0) {
    lines.push(
      `  ${unusedTransports.length} alternative transport(s) unavailable. Nothing is lost:` +
        "\n  they perceive exactly what the bundled Playwright adapter perceives.",
    );
  }
  if (blocked.length === 0) {
    lines.push("  Nothing needs setup.");
  }
  return `${lines.join("\n")}\n`;
}
