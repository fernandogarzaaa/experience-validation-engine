/**
 * Getting an artifact in front of the reader.
 *
 * A digital output arrives as a path, a URL, a pipe, or a string a caller
 * already has in hand. All four land in the same place — bytes plus an
 * address the operator could plausibly read off the artifact itself — and
 * from there the reader registry takes over.
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { readArtifactText } from "./readers/index.js";
import type { Artifact, ArtifactFormat, ArtifactGenre } from "./types.js";

/** The `doc:` scheme `eve run` uses to route a target at the humanity seam. */
export const DOC_SCHEME = "doc:";

export interface LoadArtifactOptions {
  /** Force a reader instead of letting detection choose. */
  readonly format?: ArtifactFormat;
  /** Force the genre instead of inferring it from content. */
  readonly genre?: ArtifactGenre;
  /** Milliseconds to wait on an HTTP target before giving up. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Strip the `doc:` scheme, leaving the underlying target. */
export function docTargetOf(target: string): string {
  return target.startsWith(DOC_SCHEME) ? target.slice(DOC_SCHEME.length) : target;
}

/**
 * Load an artifact from a path, an http(s) URL, or `-` for standard input.
 *
 * The address kept on the artifact is the target as written, minus the
 * `doc:` routing prefix: that is what a reader would say they were looking
 * at, and it is what every report cites.
 */
export async function loadArtifact(
  target: string,
  options: LoadArtifactOptions = {},
): Promise<Artifact> {
  const address = docTargetOf(target);
  const { text, extension } = await fetchSource(address, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return readArtifactText({
    address,
    text,
    extension,
    ...(options.genre ? { genre: options.genre } : {}),
    ...(options.format ? { format: options.format } : {}),
  });
}

/** Read an artifact already in memory — the programmatic entry point. */
export function artifactFromText(
  address: string,
  text: string,
  options: LoadArtifactOptions = {},
): Artifact {
  return readArtifactText({
    address,
    text,
    extension: extensionOf(address),
    ...(options.genre ? { genre: options.genre } : {}),
    ...(options.format ? { format: options.format } : {}),
  });
}

async function fetchSource(
  address: string,
  timeoutMs: number,
): Promise<{ text: string; extension: string | null }> {
  if (address === "-") return { text: await readStdin(), extension: null };

  if (/^https?:\/\//i.test(address)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(address, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`${address} returned ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      return { text, extension: extensionOf(address) ?? extensionForContentType(contentType) };
    } finally {
      clearTimeout(timer);
    }
  }

  return { text: await readFile(address, "utf8"), extension: extensionOf(address) };
}

function extensionOf(address: string): string | null {
  const withoutQuery = address.split(/[?#]/)[0] ?? address;
  const extension = extname(withoutQuery).toLowerCase();
  return extension || null;
}

function extensionForContentType(contentType: string): string | null {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  switch (type) {
    case "text/html":
    case "application/xhtml+xml":
      return ".html";
    case "text/markdown":
      return ".md";
    case "application/json":
      return ".json";
    case "text/csv":
      return ".csv";
    case "application/yaml":
    case "text/yaml":
      return ".yaml";
    default:
      return null;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}
