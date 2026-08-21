/**
 * HTML reader — rendered output, read rather than driven.
 *
 * The browser adapters already *operate* live pages. This reader is for the
 * other half of the web: the HTML nobody clicks. An emailed report, an
 * exported dashboard, a generated coverage summary, a static docs page saved
 * to disk. There is no live DOM here and no browser — just markup and a
 * person trying to understand what it says.
 *
 * Deliberately a tokenizer, not a DOM: EVE perceives what renders, and what
 * renders is the visible text in document order plus the structure the tags
 * imply. Script, style and template contents never reach a reader's eye, so
 * they never reach the artifact.
 */

import type { Artifact, ReaderInput, TableDetail } from "../types.js";
import { ArtifactBuilder } from "./builder.js";
import { stripHtmlTags, tableSummary } from "./markdown.js";
import { parseMetric } from "./metrics.js";

const INVISIBLE = /<(script|style|template|noscript|svg|head)\b[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)\/?>/g;

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/** Tags whose text is one block; anything else merges into the running text. */
const BLOCK_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "caption",
  "dt",
  "dd",
  "section",
  "article",
  "div",
  "td",
  "th",
  "tr",
  "table",
  "header",
  "footer",
  "main",
  "nav",
  "br",
  "hr",
  "ul",
  "ol",
  "dl",
]);

export function detectHtml(input: ReaderInput): number {
  if (input.extension === ".html" || input.extension === ".htm") return 0.95;
  const head = input.text.slice(0, 4096).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) return 0.9;
  // Several distinct block tags, not just an angle bracket in prose.
  const tags = new Set([...head.matchAll(/<\/?([a-z][a-z0-9-]*)\b/g)].map((m) => m[1]));
  return tags.size >= 4 && (tags.has("div") || tags.has("p") || tags.has("table")) ? 0.6 : 0;
}

export function readHtml(input: ReaderInput): Artifact {
  const source = input.text.replace(INVISIBLE, " ").replace(COMMENT, " ");
  const builder = new ArtifactBuilder(input.address, "html", input.genre ?? "document");

  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(input.text);
  if (documentTitle) {
    const title = decodeEntities(documentTitle[1] ?? "").trim();
    builder.setTitle(title);
    builder.setMeta("title", title);
  }

  let cursor = 0;
  let pending = "";
  /** Heading level currently open, so its text becomes a heading block. */
  let openHeading: number | null = null;
  let openPre = false;
  /** The href of the anchor currently open, if any. */
  let pendingHref: string | null = null;
  let table: { columns: string[]; rows: string[][]; row: string[] } | null = null;

  const flush = (): void => {
    const text = normalize(pending);
    pending = "";
    if (!text) return;
    if (openHeading !== null) {
      if (openHeading <= 2) builder.startSection(text);
      builder.add({ kind: openHeading === 1 ? "title" : "heading", text, depth: openHeading });
      if (openHeading === 1) builder.setTitle(text);
      return;
    }
    if (openPre) {
      builder.add({ kind: "code", text });
      return;
    }
    const metric = parseMetric(text);
    builder.add(metric ? { kind: "metric", text, metric } : { kind: "paragraph", text });
  };

  TAG.lastIndex = 0;
  let match = TAG.exec(source);
  while (match !== null) {
    pending += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    const raw = match[0];
    const name = (match[1] ?? "").toLowerCase();
    const closing = raw.startsWith("</");
    const attributes = match[2] ?? "";

    if (name === "img" && !closing) {
      flush();
      const alt = attribute(attributes, "alt");
      builder.add({
        kind: "figure",
        text: alt?.trim() || "(image with no alternative text)",
        figure: {
          alt: alt === null || !alt.trim() ? null : alt.trim(),
          caption: null,
          source: attribute(attributes, "src"),
        },
      });
    } else if (name === "a" && !closing) {
      // Links stay inline; only the href is remembered, on flush.
      const href = attribute(attributes, "href");
      if (href) pendingHref = href;
    } else if (name === "a" && closing) {
      const text = normalize(pending);
      if (pendingHref && text) {
        pending = "";
        builder.add({ kind: "reference", text, reference: pendingHref });
      }
      pendingHref = null;
    } else if (HEADING_TAGS.has(name)) {
      flush();
      openHeading = closing ? null : Number(name.slice(1));
      if (closing) openHeading = null;
    } else if (name === "pre") {
      flush();
      openPre = !closing;
    } else if (name === "table") {
      flush();
      if (!closing) {
        table = { columns: [], rows: [], row: [] };
      } else if (table) {
        const detail: TableDetail = { columns: table.columns, rows: table.rows };
        builder.add({ kind: "table", text: tableSummary(detail), table: detail });
        table = null;
      }
    } else if (table && (name === "td" || name === "th") && closing) {
      const cell = normalize(pending);
      pending = "";
      table.row.push(cell);
    } else if (table && name === "tr" && closing) {
      if (table.columns.length === 0) table.columns = table.row;
      else table.rows.push(table.row);
      table.row = [];
    } else if (BLOCK_TAGS.has(name)) {
      flush();
    }

    match = TAG.exec(source);
  }
  pending += source.slice(cursor);
  flush();

  return builder.build();
}

function attribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const found = pattern.exec(attributes);
  if (!found) return null;
  return decodeEntities(found[2] ?? found[3] ?? found[4] ?? "");
}

function normalize(text: string): string {
  // The tokenizer above consumes well-formed tags, but it needs a closing
  // `>` to recognize one — so an unterminated `<script` falls through to
  // here as text. A reader would not see it (a renderer swallows it), and
  // neither should a block, so the same complete strip applies.
  return stripHtmlTags(decodeEntities(text)).replace(/\s+/g, " ").trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body.startsWith("#x") || body.startsWith("#X")
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}
