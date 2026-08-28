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

export type SurfaceStatus = "ready" | "needs-setup" | "broken";

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

  // Selenium needs a browser *and* a driver binary on PATH, neither of which
  // it can install. Importing it is the only part EVE can honestly check;
  // claiming "ready" from a successful import would be a promise it cannot keep.
  let selenium: SurfaceReport;
  try {
    await importDriver("selenium-webdriver", "npm install selenium-webdriver");
    selenium = {
      surface: "selenium",
      status: "ready",
      provides:
        "Web apps via Selenium (also needs a browser and matching driver on PATH, which EVE cannot verify here).",
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
  const mark = (s: SurfaceStatus) => (s === "ready" ? "✓" : s === "needs-setup" ? "!" : "✗");
  const width = Math.max(...reports.map((r) => r.surface.length));
  // "  " + mark + " " + padded surface + "  " — continuation lines sit under `provides`.
  const indent = " ".repeat(width + 6);
  const lines = ["EVE surface check", ""];

  for (const r of reports) {
    lines.push(`  ${mark(r.status)} ${r.surface.padEnd(width)}  ${r.provides}`);
    if (r.detail) lines.push(`${indent}${r.detail}`);
    if (r.remedy) lines.push(`${indent}Fix: ${r.remedy}`);
  }

  const blocked = reports.filter((r) => r.status !== "ready");
  lines.push("");
  if (blocked.length === 0) {
    lines.push("  Every surface is ready.");
  } else {
    const optional = blocked.every((r) => r.surface === "puppeteer" || r.surface === "selenium");
    lines.push(
      optional
        ? `  ${blocked.length} alternative transport(s) unavailable. Nothing is lost: they perceive` +
            "\n  exactly what the bundled Playwright adapter perceives."
        : `  ${blocked.length} surface(s) need setup.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
