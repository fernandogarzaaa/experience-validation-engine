/**
 * The artifact model — what a *digital output* looks like to a reader.
 *
 * EVE's adapters have always perceived surfaces an operator **drives**: a
 * page, a phone screen, a terminal, a tool catalog. But most of what software
 * puts in front of people is not driven at all — it is *read*. A quarterly
 * report. A pitch deck. An analytics export. A `--help` screen. A stack
 * trace. An API response someone has to make sense of at 2am. Those artifacts
 * succeed or fail for human reasons — the term nobody defined, the number
 * with no baseline, the slide with forty words on it — and until now EVE had
 * no way to sit down and read one.
 *
 * `Artifact` is the format-agnostic thing every reader produces: an ordered
 * sequence of {@link ArtifactBlock}s grouped into {@link ArtifactSection}s.
 * Markdown, HTML, a deck, a CSV, a JSON response and a terminal transcript
 * all land here, which is what lets one comprehension model and one
 * {@link ArtifactGenre}-aware set of expectations apply to all of them.
 *
 * The perception boundary holds exactly as it does for the browser adapters:
 * a reader perceives what the artifact puts on the page. Front matter that
 * renders is content; a build ID buried in a comment is not.
 */

/** How the bytes were encoded — what the reader had to parse. */
export type ArtifactFormat =
  | "markdown"
  | "html"
  | "slides"
  | "json"
  | "yaml"
  | "csv"
  | "transcript"
  | "text";

/**
 * What the artifact *is*, which is what sets the reader's expectations.
 *
 * Genre is the single most load-bearing field in this model. A forty-word
 * paragraph is normal in a report and fatal on a slide. A number without a
 * baseline is fine in a spec and useless in an analytics summary. An
 * unexplained acronym in a terminal transcript is survivable; in onboarding
 * documentation it is where the reader leaves. The comprehension model
 * (`src/humanity/comprehension.ts`) branches on this, not on format.
 */
export type ArtifactGenre =
  /** A report, memo, README, spec — prose meant to be read start to end. */
  | "document"
  /** A deck: one idea per slide, read in seconds, often presented aloud. */
  | "presentation"
  /** A dashboard export or metrics summary — numbers meant to drive a decision. */
  | "analytics"
  /** A terminal session or log — what the machine said while someone worked. */
  | "transcript"
  /** A structured payload (API response, config) a human has to interpret. */
  | "data"
  /** Described interface surface: help output, form/field listings, UI copy. */
  | "interface";

/** One unit of read content. */
export type BlockKind =
  | "title"
  | "heading"
  | "paragraph"
  | "list-item"
  | "quote"
  | "code"
  | "table"
  | "figure"
  | "metric"
  | "caption"
  | "callout"
  | "reference"
  | "field"
  | "command"
  | "output"
  | "error"
  | "separator";

/** A table the reader has to hold in working memory while comparing rows. */
export interface TableDetail {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** A number presented as a result. What a reader needs is context, not digits. */
export interface MetricDetail {
  readonly label: string;
  readonly value: string;
  readonly unit: string | null;
  /** The comparison point ("vs 1.2M last quarter"), when the artifact gives one. */
  readonly baseline: string | null;
}

/** A picture, chart or diagram. `alt === null` means nothing was offered. */
export interface FigureDetail {
  readonly alt: string | null;
  readonly caption: string | null;
  readonly source: string | null;
}

export interface ArtifactBlock {
  readonly id: string;
  readonly kind: BlockKind;
  /** What the eye actually reads. */
  readonly text: string;
  /** Heading level, or list nesting depth; 0 for top-level prose. */
  readonly depth: number;
  /** Index into {@link Artifact.sections}. */
  readonly section: number;
  readonly table?: TableDetail;
  readonly metric?: MetricDetail;
  readonly figure?: FigureDetail;
  /** Target of a link or cross-reference ("#results", "https://…", "Figure 3"). */
  readonly reference?: string;
  /** Fence language on a code block, when declared. */
  readonly language?: string;
}

/** How a section is named for the reader — the noun that appears in reports. */
export type SectionNoun = "section" | "slide" | "page" | "screen" | "record";

export interface ArtifactSection {
  readonly index: number;
  /** The section's own heading, or a synthesized label when it has none. */
  readonly title: string;
  readonly noun: SectionNoun;
  /** Indices into {@link Artifact.blocks}, in reading order. */
  readonly blocks: readonly number[];
}

export interface Artifact {
  /** Operator-visible address: a path, a URL, or `-` for piped input. */
  readonly address: string;
  readonly title: string;
  readonly format: ArtifactFormat;
  readonly genre: ArtifactGenre;
  readonly sections: readonly ArtifactSection[];
  /** Every block, in reading order. */
  readonly blocks: readonly ArtifactBlock[];
  /**
   * Metadata the artifact itself displays (front matter, an HTML `<title>`,
   * a CSV's column count). Never file-system or build metadata: a reader
   * cannot see those.
   */
  readonly meta: Readonly<Record<string, string>>;
}

/** A reader that turns raw bytes of one format into an {@link Artifact}. */
export interface ArtifactReader {
  readonly name: string;
  readonly format: ArtifactFormat;
  /** Confidence, 0..1, that this reader should handle the input. */
  detect(input: ReaderInput): number;
  read(input: ReaderInput): Artifact;
}

export interface ReaderInput {
  readonly address: string;
  readonly text: string;
  /** Lowercased file extension including the dot (".md"), when known. */
  readonly extension: string | null;
  /** Caller's genre override; readers otherwise infer it from content. */
  readonly genre?: ArtifactGenre;
}

/** The noun a genre uses for one section, for reports and percept labels. */
export function sectionNounFor(genre: ArtifactGenre): SectionNoun {
  switch (genre) {
    case "presentation":
      return "slide";
    case "analytics":
      return "screen";
    case "data":
      return "record";
    case "transcript":
    case "document":
    case "interface":
      return "section";
  }
}

/** Words in a block, counted the way a reader consumes them. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Total words in an artifact — how long the read is. */
export function artifactWordCount(artifact: Artifact): number {
  return artifact.blocks.reduce((total, block) => total + wordCount(block.text), 0);
}
