/**
 * Markdown reader — documents and decks.
 *
 * Markdown is where most software writes to humans: READMEs, specs, release
 * notes, runbooks, and (with `---` between slides) a large share of the
 * world's technical presentations. The reader perceives what renders — a
 * heading is a heading because it looks like one, an image with no alt text
 * is a picture the reader cannot interpret — and nothing that does not.
 */

import type { Artifact, ArtifactGenre, ReaderInput, TableDetail } from "../types.js";
import { ArtifactBuilder } from "./builder.js";
import { parseMetric } from "./metrics.js";

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const SETEXT_H1 = /^\s{0,3}={3,}\s*$/;
const SETEXT_H2 = /^\s{0,3}-{3,}\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
/**
 * A table's divider row (`| --- | :---: |`) is a line made of nothing but
 * pipes, dashes, colons and spaces.
 *
 * Deliberately one unambiguous character class plus two `includes` checks,
 * rather than the natural `[\s:|-]+\|[\s:|-]*` phrasing: there, every pipe in
 * the line is a candidate split point for the literal `\|`, so a long line of
 * pipes and dashes that ends up not matching costs quadratic time. Readers
 * parse whatever a caller points them at, so a pathological line is input,
 * not an attack that needs to get past anything.
 */
const TABLE_DIVIDER_CHARS = /^[\s:|-]+$/;

function isTableDivider(line: string): boolean {
  return TABLE_DIVIDER_CHARS.test(line) && line.includes("|") && line.includes("-");
}
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const LINK = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CALLOUT = /^\s{0,3}>\s*\[!(\w+)\]\s*(.*)$/;

/** Deck heuristics: `---` separators carrying headings, or a slides extension. */
export function looksLikeSlides(text: string, extension: string | null): boolean {
  if (extension === ".slides.md") return true;
  const lines = text.split(/\r?\n/);
  let breaks = 0;
  let headingsAfterBreak = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!THEMATIC_BREAK.test(lines[i] ?? "")) continue;
    // A `---` directly under text is a setext H2 underline, not a break.
    if ((lines[i - 1] ?? "").trim() && SETEXT_H2.test(lines[i] ?? "")) continue;
    breaks++;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (HEADING.test(lines[j] ?? "")) {
        headingsAfterBreak++;
        break;
      }
    }
  }
  return breaks >= 2 && headingsAfterBreak >= breaks - 1;
}

export function readMarkdown(input: ReaderInput): Artifact {
  const raw = input.text.replace(/\r\n/g, "\n");
  const { body, frontMatter } = splitFrontMatter(raw);
  const slides = input.genre === "presentation" || looksLikeSlides(body, input.extension);
  const genre: ArtifactGenre = input.genre ?? (slides ? "presentation" : inferProseGenre(body));

  const builder = new ArtifactBuilder(input.address, slides ? "slides" : "markdown", genre);
  for (const [key, value] of Object.entries(frontMatter)) {
    builder.setMeta(key, value);
    if (key.toLowerCase() === "title") builder.setTitle(value);
  }

  const lines = body.split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (!text) return;
    emitProse(builder, text);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1] ?? "```";
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith(marker.slice(0, 3))) {
        code.push(lines[i] ?? "");
        i++;
      }
      builder.add({
        kind: "code",
        text: code.join("\n"),
        ...(fence[2] ? { language: fence[2] } : {}),
      });
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    // A `---` under a paragraph is a setext H2; standing alone it separates.
    if (THEMATIC_BREAK.test(line)) {
      if (paragraph.length > 0 && SETEXT_H2.test(line)) {
        const text = paragraph.join(" ").trim();
        paragraph = [];
        builder.startSection(text);
        builder.add({ kind: "heading", text, depth: 2 });
        continue;
      }
      flushParagraph();
      if (slides) builder.startSection("");
      else builder.add({ kind: "separator", text: "———" });
      continue;
    }

    if (SETEXT_H1.test(line) && paragraph.length > 0) {
      const text = paragraph.join(" ").trim();
      paragraph = [];
      builder.setTitle(text);
      builder.startSection(text);
      builder.add({ kind: "title", text, depth: 1 });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const depth = (heading[1] ?? "#").length;
      const text = stripInline(heading[2] ?? "");
      if (depth === 1) builder.setTitle(text);
      // Slides are cut by `---`; prose is cut by its top two heading levels.
      if (!slides && depth <= 2) builder.startSection(text);
      else if (slides && builder.size === 0) builder.startSection(text);
      else if (slides) builder.nameCurrentSection(text);
      builder.add({ kind: depth === 1 ? "title" : "heading", text, depth });
      continue;
    }

    const table = readTable(lines, i);
    if (table) {
      flushParagraph();
      builder.add({ kind: "table", text: tableSummary(table.detail), table: table.detail });
      i = table.endIndex;
      continue;
    }

    const callout = CALLOUT.exec(line);
    if (callout) {
      flushParagraph();
      builder.add({
        kind: "callout",
        text: `${callout[1]}: ${stripInline(callout[2] ?? "")}`.trim(),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      builder.add({ kind: "quote", text: stripInline(quote[1] ?? "") });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const depth = Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2);
      emitProse(builder, stripInline(item[2] ?? ""), "list-item", depth);
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();

  return builder.build();
}

/**
 * Emit one piece of prose, promoting the shapes a reader treats as more than
 * a sentence: a bare image is a figure, a bare link is a reference, and
 * "Revenue: $1.2M (up 14% QoQ)" is a metric, not a sentence.
 */
function emitProse(
  builder: ArtifactBuilder,
  text: string,
  kind: "paragraph" | "list-item" = "paragraph",
  depth = 0,
): void {
  const figures = [...text.matchAll(IMAGE)];
  if (figures.length > 0) {
    for (const match of figures) {
      const alt = (match[1] ?? "").trim();
      builder.add({
        kind: "figure",
        text: alt || "(image with no alternative text)",
        figure: { alt: alt || null, caption: null, source: match[2] ?? null },
      });
    }
    const remainder = stripInline(text.replace(IMAGE, " ")).trim();
    if (remainder) builder.add({ kind, text: remainder, depth });
    return;
  }

  const metric = parseMetric(stripInline(text));
  if (metric) {
    builder.add({ kind: "metric", text: stripInline(text), depth, metric });
    return;
  }

  const links = [...text.matchAll(LINK)];
  const plain = stripInline(text);
  if (links.length === 1 && plain === (links[0]?.[1] ?? "").trim()) {
    builder.add({ kind: "reference", text: plain, depth, reference: links[0]?.[2] ?? "" });
    return;
  }
  builder.add({ kind, text: plain, depth });
}

/** Strip the syntax a renderer consumes, leaving the text a reader sees. */
export function stripInline(text: string): string {
  return stripHtmlTags(
    text
      .replace(IMAGE, (_m, alt: string) => (alt ? `${alt} (image)` : "(image)"))
      .replace(LINK, (_m, label: string) => label)
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
      .replace(/__([^_]+)__/g, "$1"),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A tag: `<`, an optional `/`, then a name character — with or without the
 * closing `>`. Unterminated tags are included deliberately: `<script` with
 * no `>` is markup a renderer swallows, so a reader never sees it either.
 * `[^<>]*` rather than `[^>]*` so a tag cannot swallow the `<` that starts
 * the next one, which keeps nesting resolving innermost-first.
 */
const HTML_TAG = /<\/?[a-zA-Z][^<>]*>?/g;

/** Nesting deeper than this is not markup anyone wrote; see the backstop. */
const MAX_TAG_PASSES = 8;

/**
 * Remove HTML tags from markdown source.
 *
 * Repeated to a fixpoint rather than done in one pass: removing `<a>` from
 * `<<a>script>` splices the halves back together into `<script>`, and a
 * single global replace never revisits the ground it has already covered.
 * The passes are bounded and the loop ends with a sweep for any `<` still
 * beginning a tag, so deep nesting can neither outrun the fixpoint nor make
 * a pathological line cost quadratic time.
 *
 * A lone `<` in prose ("if x < y") is not a tag and survives, because that
 * is what a reader sees.
 *
 * This is **not** a sanitizer and must not be used as one. It exists so a
 * block's perceived text is what a reader would read rather than the markup
 * a renderer consumes. Escaping for output is the renderer's job and is done
 * independently — see `escapeHtml` in `src/reporting/html.ts`.
 */
export function stripHtmlTags(text: string): string {
  let stripped = text;
  for (let pass = 0; pass < MAX_TAG_PASSES; pass++) {
    const next = stripped.replace(HTML_TAG, "");
    if (next === stripped) return next;
    stripped = next;
  }
  return stripped.replace(/<(?=\/?[a-zA-Z])/g, "");
}

interface ParsedTable {
  readonly detail: TableDetail;
  readonly endIndex: number;
}

function readTable(lines: readonly string[], start: number): ParsedTable | null {
  const header = TABLE_ROW.exec(lines[start] ?? "");
  if (!header) return null;
  if (!isTableDivider(lines[start + 1] ?? "")) return null;

  const columns = splitRow(lines[start] ?? "");
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && TABLE_ROW.test(lines[index] ?? "")) {
    rows.push(splitRow(lines[index] ?? ""));
    index++;
  }
  return { detail: { columns, rows }, endIndex: index - 1 };
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => stripInline(cell.trim()));
}

/** What a reader takes away at a glance: the shape, then the header row. */
export function tableSummary(detail: TableDetail): string {
  return `Table (${detail.rows.length} rows × ${detail.columns.length} columns): ${detail.columns.join(", ")}`;
}

function splitFrontMatter(text: string): {
  body: string;
  frontMatter: Record<string, string>;
} {
  if (!text.startsWith("---\n")) return { body: text, frontMatter: {} };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { body: text, frontMatter: {} };
  const block = text.slice(4, end);
  const frontMatter: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (match) frontMatter[match[1] ?? ""] = (match[2] ?? "").replace(/^["']|["']$/g, "");
  }
  const rest = text.slice(end + 4).replace(/^\n/, "");
  return { body: rest, frontMatter };
}

/** Prose that is mostly numbers-with-baselines reads as an analytics summary. */
function inferProseGenre(body: string): ArtifactGenre {
  const lines = body.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "document";
  const metricLines = lines.filter((line) => parseMetric(stripInline(line)) !== null).length;
  return metricLines >= 4 && metricLines / lines.length >= 0.3 ? "analytics" : "document";
}
