import { resolve, sep } from "node:path";

/**
 * Operational safety helpers (P1.12).
 *
 * EVE drives arbitrary URLs in real browsers, spawns MCP stdio commands, and
 * writes report files — all user-authorized operations, none safe-by-default
 * for untrusted inputs. These helpers make the trust boundary explicit and
 * fix the concrete, low-cost issues:
 *
 * - report/output paths: fixed filenames joined under a resolved output dir
 *   (no URL/title-derived segments), so traversal via page content is
 *   impossible;
 * - navigation: optional host allowlist enforced on session-initiated
 *   navigations (`assertUrlAllowed`);
 * - MCP stdio: documented execute-with-user-authorized-code semantics (see
 *   `connectMcpServer`); no shell is ever used for tokenization.
 */

/** Join fixed filenames under `dir`, resolving against traversal. */
export function safeJoin(dir: string, ...segments: string[]): string {
  const base = resolve(dir);
  const joined = resolve(base, ...segments);
  if (joined !== base && !joined.startsWith(base + sep)) {
    throw new Error(`refusing to write outside output dir: ${segments.join("/")}`);
  }
  return joined;
}

/** Strip directory components and unsafe chars from a dynamic filename. */
export function sanitizeFilename(name: string, fallback = "report"): string {
  const base = name.split(/[\\/]/).at(-1) ?? fallback;
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return clean || fallback;
}

/**
 * Enforce an optional host allowlist. Only http(s) URLs are checked —
 * anything else (mock:, about:, data:) is an offline fixture or an internal
 * page, not a network navigation. Absent/empty allowlist = no restriction
 * (backwards compat); present = http(s) navigation outside it throws.
 */
export function assertUrlAllowed(url: string, allowlist?: readonly string[]): void {
  if (!allowlist || allowlist.length === 0) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`navigation blocked: unparseable URL "${url}" under an allowlist`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
  const host = parsed.hostname.toLowerCase();
  const ok = allowlist.some(
    (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`),
  );
  if (!ok)
    throw new Error(`navigation to "${host}" blocked by allowlist [${allowlist.join(", ")}]`);
}
