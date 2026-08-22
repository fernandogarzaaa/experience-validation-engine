/**
 * Plain-text reader — the last resort, and a real format in its own right.
 *
 * Release notes pasted into a text file, an email body, a `--help` screen
 * captured to disk, a LICENSE. There is no markup to lean on, so structure
 * is inferred the way a person infers it: blank lines separate paragraphs,
 * a short line in isolation is a heading, indented runs are code or output,
 * and a line that starts with a bullet character is a bullet.
 *
 * Two-space-indented `command    description` pairs are how every CLI on
 * earth prints its help, so text shaped that way is read as an interface
 * listing rather than as prose.
 */

import type { Artifact, ArtifactGenre, ReaderInput } from "../types.js";
import { ArtifactBuilder } from "./builder.js";
import { parseMetric } from "./metrics.js";

const BULLET = /^(\s*)(?:[-*•‣◦]|\d{1,3}[.)])\s+(.*)$/;
/** `  build          Compile the project` — an entry that documents itself. */
const HELP_ENTRY = /^\s{2,}(-{0,2}[A-Za-z][\w:,|<>[\]-]*(?:,?\s+-{1,2}[\w-]+)*)\s{2,}(\S.*)$/;
/** `  serve` — an entry listed with nothing said about it. */
const BARE_ENTRY = /^\s{2,}(-{0,2}[A-Za-z][\w:,|<>[\]-]*(?:,?\s+-{1,2}[\w-]+)*)\s*$/;
const HELP_SECTION = /^([A-Z][A-Za-z ]{2,30}):\s*$/;
/** The line every CLI on earth prints first. */
const USAGE_LINE = /^(?:usage|synopsis)\s*:/i;
/** A short, unpunctuated line standing alone reads as a heading. */
const MAX_HEADING_WORDS = 10;

export function readText(input: ReaderInput): Artifact {
  const lines = input.text.replace(/\r\n/g, "\n").split("\n");
  const genre: ArtifactGenre = input.genre ?? inferGenre(lines);
  const builder = new ArtifactBuilder(input.address, "text", genre);

  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    const solo = paragraph.length === 1;
    paragraph = [];
    if (!text) return;
    if (solo && isHeadingLike(text)) {
      builder.startSection(text);
      builder.add({ kind: "heading", text, depth: 2 });
      return;
    }
    const metric = parseMetric(text);
    builder.add(metric ? { kind: "metric", text, metric } : { kind: "paragraph", text });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      flush();
      continue;
    }

    const section = HELP_SECTION.exec(line);
    if (section) {
      flush();
      builder.startSection(section[1] ?? "");
      builder.add({ kind: "heading", text: section[1] ?? "", depth: 2 });
      continue;
    }

    if (genre === "interface") {
      const entry = HELP_ENTRY.exec(line);
      if (entry) {
        flush();
        builder.add({ kind: "field", text: `${entry[1]} — ${entry[2]}`.trim() });
        continue;
      }
      // An entry with no description is still an entry. Keeping it as a
      // field rather than prose is what lets the comprehension model say
      // the true thing about it: it was listed and never explained.
      const bare = BARE_ENTRY.exec(line);
      if (bare) {
        flush();
        builder.add({ kind: "field", text: (bare[1] ?? "").trim() });
        continue;
      }
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const depth = Math.floor((bullet[1] ?? "").replace(/\t/g, "  ").length / 2);
      builder.add({ kind: "list-item", text: (bullet[2] ?? "").trim(), depth });
      continue;
    }

    // A run of indented lines with no prose around it is code or output.
    if (/^\s{4,}\S/.test(line) && paragraph.length === 0) {
      const code: string[] = [];
      while (i < lines.length && (/^\s{4,}\S/.test(lines[i] ?? "") || !(lines[i] ?? "").trim())) {
        code.push(lines[i] ?? "");
        i++;
      }
      i--;
      // The lookahead above swallows the blank lines after the block; drop
      // them by popping, not with an end-anchored `/\n+$/` replace, which
      // retries from every position of a long final line.
      while (code.length > 0 && !(code.at(-1) ?? "").trim()) code.pop();
      builder.add({ kind: "code", text: code.join("\n") });
      continue;
    }

    paragraph.push(line.trim());
  }
  flush();

  return builder.build();
}

function isHeadingLike(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_HEADING_WORDS) return false;
  if (/[.!?,;]$/.test(text)) return false;
  // ALL CAPS, Title Case, or a trailing colon are all how plain text shouts.
  return text === text.toUpperCase() || /:$/.test(text) || /^[A-Z]/.test(text);
}

function inferGenre(lines: readonly string[]): ArtifactGenre {
  const nonEmpty = lines.filter((l) => l.trim());
  if (nonEmpty.length === 0) return "document";
  // Help output is recognizable from across the room: a usage line, section
  // headers, and a column of indented entries. Entries listed *without* a
  // description count toward the shape — they are the ones worth flagging.
  const entries = nonEmpty.filter((l) => HELP_ENTRY.test(l) || BARE_ENTRY.test(l)).length;
  const usage = nonEmpty.some((l) => USAGE_LINE.test(l.trim()));
  if (entries >= 3 && (usage || entries / nonEmpty.length >= 0.4)) return "interface";
  const metrics = nonEmpty.filter((l) => parseMetric(l.trim()) !== null).length;
  if (metrics >= 4 && metrics / nonEmpty.length >= 0.3) return "analytics";
  return "document";
}
