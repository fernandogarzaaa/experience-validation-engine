/**
 * The reader registry — how bytes become something a human can read.
 *
 * Detection is a confidence auction, not a switch on file extension. An
 * artifact reaches EVE in a lot of ways that carry no filename: piped into
 * `eve read -`, pasted into an issue, returned by an API call, handed over
 * as a string by a programmatic caller. Every reader scores the input and the
 * highest bidder wins, with the plain-text reader as the floor — because a
 * person handed an unrecognizable file still reads it.
 */

import type { Artifact, ArtifactFormat, ArtifactReader, ReaderInput } from "../types.js";
import {
  detectDelimited,
  detectJson,
  detectYaml,
  readDelimited,
  readJson,
  readYaml,
} from "./data.js";
import { detectHtml, readHtml } from "./html.js";
import { looksLikeSlides, readMarkdown } from "./markdown.js";
import { readText } from "./text.js";
import { detectTranscript, readTranscript } from "./transcript.js";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".mdown"]);

/** Markdown syntax a plain-text file would not contain by accident. */
const MARKDOWN_SIGNALS = [
  /^\s{0,3}#{1,6}\s+\S/m,
  /^\s{0,3}[-*+]\s+\S/m,
  /^\s{0,3}```/m,
  /\[[^\]]+\]\([^)\s]+\)/,
  /^\s*\|.+\|\s*$/m,
];

const READERS: readonly ArtifactReader[] = [
  {
    name: "markdown",
    format: "markdown",
    detect: (input) => {
      if (input.extension && MARKDOWN_EXTENSIONS.has(input.extension)) return 0.95;
      const hits = MARKDOWN_SIGNALS.filter((pattern) => pattern.test(input.text)).length;
      return hits >= 2 ? 0.5 + hits * 0.1 : 0;
    },
    read: readMarkdown,
  },
  { name: "html", format: "html", detect: detectHtml, read: readHtml },
  { name: "json", format: "json", detect: detectJson, read: readJson },
  { name: "yaml", format: "yaml", detect: detectYaml, read: readYaml },
  { name: "delimited", format: "csv", detect: detectDelimited, read: readDelimited },
  { name: "transcript", format: "transcript", detect: detectTranscript, read: readTranscript },
  { name: "text", format: "text", detect: () => 0.1, read: readText },
];

export function listReaders(): readonly ArtifactReader[] {
  return READERS;
}

/** The reader that bids highest for this input. Never null — text is the floor. */
export function selectReader(input: ReaderInput): ArtifactReader {
  let best = READERS[READERS.length - 1] as ArtifactReader;
  let bestScore = -1;
  for (const reader of READERS) {
    const score = reader.detect(input);
    if (score > bestScore) {
      best = reader;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Read any digital output into an {@link Artifact}.
 *
 * `format` forces a reader when the caller knows better than detection — a
 * markdown deck served without an extension, a log captured as `.txt`.
 */
export function readArtifactText(
  input: ReaderInput & { readonly format?: ArtifactFormat },
): Artifact {
  // "slides" is a markdown *shape*, not a reader of its own: no entry
  // advertises it, so forcing it has to route to the markdown reader and
  // tell it which shape to expect. Relabelling afterwards would keep
  // whatever detection picked — the plain-text reader, for a deck piped in
  // with no extension — and silently lose `---` breaks, links and tables,
  // in exactly the case the override exists to handle.
  const effective: ReaderInput & { readonly format?: ArtifactFormat } =
    input.format === "slides" ? { ...input, genre: input.genre ?? "presentation" } : input;

  const forced = effective.format
    ? (READERS.find((reader) => reader.format === effective.format) ??
      (effective.format === "slides"
        ? READERS.find((reader) => reader.format === "markdown")
        : undefined))
    : undefined;
  const reader = forced ?? selectReader(effective);
  const artifact = reader.read(effective);
  if (effective.format === "slides" && artifact.format !== "slides") {
    return { ...artifact, format: "slides", genre: "presentation" };
  }
  return artifact;
}

export { ArtifactBuilder } from "./builder.js";
export { parseMetric } from "./metrics.js";
export {
  looksLikeSlides,
  readDelimited,
  readHtml,
  readJson,
  readMarkdown,
  readText,
  readTranscript,
  readYaml,
};
