/**
 * Loading the browser drivers, and saying something useful when it fails.
 *
 * Playwright ships as a real dependency, so the visual surface works from a
 * plain `npm install`. Puppeteer and Selenium remain on-demand: they are
 * *alternative transports for the same modality*, held at deliberate parity
 * with Playwright (see `docs/architecture.md`), so bundling them would add a
 * second browser download and an external driver requirement without adding
 * a single capability.
 *
 * "On-demand" is only acceptable if the failure explains itself, which is why
 * the two cases below are kept apart. A driver that is absent and a driver
 * that is present but broken need opposite responses from the user, and
 * reporting the second as the first sends them to reinstall a package they
 * already have.
 */

/** The driver package is not installed. Recoverable by installing it. */
export class DriverMissingError extends Error {
  readonly driver: string;
  readonly installCommand: string;

  constructor(driver: string, installCommand: string) {
    super(
      `EVE's ${driver} adapter needs the "${driver}" package, which is not installed.\n` +
        `Install it with: ${installCommand}\n` +
        "Or use the bundled Playwright adapter instead (--browser playwright), which needs no extra install.",
    );
    this.name = "DriverMissingError";
    this.driver = driver;
    this.installCommand = installCommand;
  }
}

/** The driver package is installed but failed to load. Not an install problem. */
export class DriverLoadError extends Error {
  readonly driver: string;

  constructor(driver: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `EVE's ${driver} adapter found the "${driver}" package but could not load it: ${detail}\n` +
        "The package is installed, so reinstalling it is unlikely to help — this usually means a " +
        "version mismatch or a broken install.",
    );
    this.name = "DriverLoadError";
    this.driver = driver;
    this.cause = cause;
  }
}

/**
 * True only when `spec` itself could not be resolved.
 *
 * Node reports a module missing *inside* the driver with the same error code,
 * so the code alone cannot tell "puppeteer is not installed" from "puppeteer
 * is installed and one of its own dependencies is not". The specifier has to
 * appear in the message for the first reading to be the right one.
 */
function isModuleNotFound(error: unknown, spec: string): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;
  const message = error instanceof Error ? error.message : "";
  return message.includes(`'${spec}'`) || message.includes(`"${spec}"`);
}

/**
 * Import an optional driver, classifying the two failure modes.
 *
 * The specifier is passed as a value rather than written inline so the
 * bundler and `tsc` do not try to resolve an optional package at build time.
 * Callers unwrap the namespace themselves: the drivers disagree about whether
 * the useful surface is the default export or the namespace, and guessing
 * here would paper over that.
 */
export async function importDriver(spec: string, installCommand: string): Promise<unknown> {
  try {
    return await import(spec);
  } catch (error) {
    if (isModuleNotFound(error, spec)) throw new DriverMissingError(spec, installCommand);
    throw new DriverLoadError(spec, error);
  }
}

/**
 * True when a launch failure is Playwright's "browser binaries are missing".
 *
 * Distinct from a missing package: the npm package installs the driver, but
 * the browser executables are fetched by a postinstall step that CI images
 * and sandboxes routinely skip (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`). The
 * package is present and importable; there is simply no Chromium to launch.
 */
export function isMissingBrowserBinary(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Executable doesn't exist") ||
    message.includes("playwright install") ||
    message.includes("Failed to launch")
  );
}
