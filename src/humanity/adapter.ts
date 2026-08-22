/**
 * HumanityAdapter — EVE sits down and reads.
 *
 * Every other adapter puts the operator in front of something they *drive*.
 * This one puts a reader in front of something they *receive*: a report, a
 * deck, a dashboard export, a `--help` screen, a stack trace, an API payload.
 * That is most of what software actually shows people, and until now EVE
 * could not experience any of it.
 *
 * **Kernel-native.** The adapter's source of truth is the document kernel
 * (`src/core/kernel.ts`): reading order as geometry, sections as the unit
 * the reader turns between, and typed signals for the two things that
 * genuinely happen while reading — reaching the end, and hitting something
 * you do not understand. The legacy browser-flavored snapshot is derived
 * from the same state, so every Phase-1 consumer (scoring, workflows,
 * reports, the session loop) works on a reading session unchanged.
 *
 * | Kernel concept   | Reading                              | Deprecated web view      |
 * | ---------------- | ------------------------------------ | ------------------------ |
 * | frame identity   | address + section title              | `url` / `title`          |
 * | affordances      | blocks, references, next/prev section | text lines + links       |
 * | comprehension    | `comprehension-gap` signal            | a fake modal "dialog"    |
 * | end of artifact  | `end-of-content` signal              | a final line of text     |
 * | reading position | section index + blocks read           | scroll offset            |
 *
 * The perception boundary is unchanged and, if anything, tighter: a reader
 * perceives the artifact's rendered content and nothing else. There is no
 * source, no file metadata, no build information — a person handed a PDF
 * cannot see who generated it either.
 */

import type { BrowserAdapter, KernelSurface, RawSnapshot } from "../browser/adapter.js";
import type {
  Affordance,
  ContentBlock,
  DocumentKernelPercept,
  KernelAction,
  SurfaceSignal,
} from "../core/kernel.js";
import type { Point, Viewport } from "../core/types.js";
import { getPersona } from "../personas/library.js";
import type { Persona } from "../personas/persona.js";
import { DOCUMENT_SURFACE, DOCUMENT_VERBS } from "../surface/capabilities.js";
import { webPerceptFromKernel } from "../surface/kernelView.js";
import { analyzeComprehension, type BlockComprehension } from "./comprehension.js";
import { artifactFromText, docTargetOf, loadArtifact } from "./source.js";
import type { Artifact, ArtifactBlock, ArtifactFormat, ArtifactGenre } from "./types.js";
import { wordCount } from "./types.js";

export interface HumanityAdapterOptions {
  /**
   * Read this artifact instead of loading one from the target. The
   * programmatic path — and how tests avoid touching the filesystem.
   */
  readonly artifact?: Artifact;
  /** Force a reader instead of letting detection choose. */
  readonly format?: ArtifactFormat;
  /** Force the genre instead of inferring it from content. */
  readonly genre?: ArtifactGenre;
  /**
   * The persona doing the reading. Comprehension is persona-relative — the
   * same paragraph loses a first-time user and not a specialist — so the
   * adapter needs it to know which gaps the reader actually perceives.
   * Defaults to the baseline reader; `EveSession` passes the real one.
   */
  readonly persona?: Persona;
  /** Milliseconds to wait on an http(s) target. */
  readonly timeoutMs?: number;
}

/** What the reader has done with one section. */
interface SectionState {
  /** Blocks read closely (as opposed to skimmed). */
  readonly read: Set<string>;
  /**
   * The reader has passed their eyes over the whole section, without taking
   * in the detail. Tracked separately from {@link read} because the two
   * answer different questions: `read` is what the reader *understood* and
   * drives comprehension gaps, `skimmed` is where they have *been*. A
   * skimmer does not retain what they skipped, but they do know they reached
   * the end of the document — those are not the same faculty.
   */
  skimmed: boolean;
  rereads: number;
}

export class HumanityAdapter implements BrowserAdapter, KernelSurface {
  readonly name = "humanity";
  readonly capabilities = { ...DOCUMENT_SURFACE, actionVerbs: DOCUMENT_VERBS };

  private artifact: Artifact | null = null;
  private persona: Persona;
  private section = 0;
  private openedAt = Date.now();
  private readonly sections = new Map<number, SectionState>();
  /** Sections visited, most recent last — the reader's way back. */
  private readonly trail: number[] = [];
  private comprehension = new Map<string, BlockComprehension>();
  /** Gaps perceived on the current view; cleared when the reader moves. */
  private gaps: SurfaceSignal[] = [];

  constructor(private readonly options: HumanityAdapterOptions = {}) {
    // Comprehension is persona-relative, so the adapter always has one. The
    // default is the ordinary reader, not a specialist: assuming expertise
    // would quietly hide every gap this adapter exists to find.
    this.persona = options.persona ?? getPersona("first-time-user");
    // A supplied artifact is available immediately, before `open()`: callers
    // need `endMarker()` to build the session before the session opens it.
    if (options.artifact) this.openArtifact(options.artifact);
  }

  /** Strip the `doc:` scheme; the remainder is the artifact's address. */
  static targetOf(url: string): string {
    return docTargetOf(url);
  }

  /** The artifact currently open, for callers that want the model itself. */
  currentArtifact(): Artifact | null {
    return this.artifact;
  }

  /**
   * The line the reader sees at the end of the artifact. Exposed because
   * finishing a document is a real, perceivable outcome, and callers wire it
   * up as the session's goal success signal rather than having the reader
   * "abandon" a document they in fact finished.
   */
  endMarker(): string {
    return endMarkerFor(this.artifact);
  }

  /**
   * The reader. `EveSession` calls this through the optional
   * `attachOperator` hook before opening, so a session's persona is the one
   * whose comprehension the adapter reports.
   */
  attachOperator(persona: Persona): void {
    this.persona = persona;
    if (this.artifact) this.recomputeComprehension();
  }

  async open(url: string, _viewport: Viewport): Promise<void> {
    this.artifact =
      this.options.artifact ??
      (await loadArtifact(url, {
        ...(this.options.format ? { format: this.options.format } : {}),
        ...(this.options.genre ? { genre: this.options.genre } : {}),
        ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
      }));
    this.openedAt = Date.now();
    this.section = 0;
    this.sections.clear();
    this.trail.length = 0;
    this.gaps = [];
    this.recomputeComprehension();
  }

  /** Open an artifact already in memory, without touching the filesystem. */
  openArtifact(artifact: Artifact): void {
    this.artifact = artifact;
    this.openedAt = Date.now();
    this.section = 0;
    this.sections.clear();
    this.trail.length = 0;
    this.gaps = [];
    this.recomputeComprehension();
  }

  /* ---------------------------------------------------------------- */
  /* Kernel-native perception                                          */
  /* ---------------------------------------------------------------- */

  async kernelPercept(): Promise<DocumentKernelPercept> {
    const artifact = this.requireArtifact();
    const section = artifact.sections[this.section];
    const blocks = (section?.blocks ?? []).map((index) => artifact.blocks[index]).filter(isBlock);

    const signals: SurfaceSignal[] = [...this.gaps];
    if (this.atEnd()) {
      signals.push({ type: "end-of-content", label: endMarkerFor(artifact) });
    }

    return {
      modality: "document",
      timestamp: Date.now() - this.openedAt,
      frame: {
        address: artifact.address,
        label: section?.title ?? artifact.title,
        surfaceState: `${section?.noun ?? "section"} ${this.section + 1}/${artifact.sections.length}`,
      },
      affordances: this.affordances(artifact, blocks),
      signals,
      blocks: blocks.map(toContentBlock),
      section: this.section,
      sectionCount: artifact.sections.length,
      sectionNoun: section?.noun ?? "section",
      totalBlocks: artifact.blocks.length,
      blocksRead: this.blocksRead(),
    };
  }

  /**
   * What a reader can act on here: the blocks worth stopping over, the
   * references that lead elsewhere, and the two ways out of the section.
   *
   * Prose paragraphs are not affordances — reading them is what `doc.read`
   * does to the whole section. A table, a figure and a metric *are*, because
   * stopping to work one out is a distinct act a reader chooses to take.
   */
  private affordances(artifact: Artifact, blocks: readonly ArtifactBlock[]): readonly Affordance[] {
    const affordances: Affordance[] = [];

    for (const block of blocks) {
      const kind = affordanceKind(block);
      if (!kind) continue;
      const understanding = this.comprehension.get(block.id);
      affordances.push({
        id: block.id,
        kind,
        locator: {
          kind: "readingOrder",
          section: this.section,
          block: artifact.blocks.indexOf(block),
        },
        description: block.text,
        state: {
          enabled: true,
          metadata: {
            blockKind: block.kind,
            words: wordCount(block.text),
            ...(understanding
              ? {
                  comprehension: Math.round(understanding.comprehension * 100) / 100,
                  obstacles: understanding.obstacles.map((obstacle) => obstacle.kind),
                }
              : {}),
            ...(block.reference ? { reference: block.reference } : {}),
            ...(block.table
              ? { columns: block.table.columns.length, rows: block.table.rows.length }
              : {}),
            ...(block.metric ? { hasBaseline: block.metric.baseline !== null } : {}),
            ...(block.figure
              ? { described: block.figure.alt !== null || block.figure.caption !== null }
              : {}),
          },
        },
      });
    }

    if (this.section + 1 < artifact.sections.length) {
      const next = artifact.sections[this.section + 1];
      affordances.push({
        id: `section:${this.section + 1}`,
        kind: "doc.section",
        locator: { kind: "readingOrder", section: this.section + 1, block: 0 },
        description: `Next ${next?.noun ?? "section"}: ${next?.title ?? ""}`.trim(),
        state: { enabled: true, metadata: { direction: "next", section: this.section + 1 } },
      });
    }
    if (this.section > 0) {
      const previous = artifact.sections[this.section - 1];
      affordances.push({
        id: `section:${this.section - 1}`,
        kind: "doc.section",
        locator: { kind: "readingOrder", section: this.section - 1, block: 0 },
        description: `Back to: ${previous?.title ?? ""}`.trim(),
        state: { enabled: true, metadata: { direction: "back", section: this.section - 1 } },
      });
    }

    return affordances;
  }

  async actKernel(action: KernelAction): Promise<void> {
    const artifact = this.requireArtifact();
    const state = this.stateFor(this.section);

    switch (action.verb) {
      case "doc.read": {
        // Reading the section closely: every block in it is now read, and
        // the ones this reader did not follow become perceived gaps.
        const blocks = this.blocksOf(this.section);
        for (const block of blocks) state.read.add(block.id);
        this.gaps = this.gapsFor(blocks);
        return;
      }
      case "doc.skim": {
        // Skimming takes headings and shape. Detail is not retained, so the
        // blocks are not marked read and the gaps are not perceived yet.
        state.skimmed = true;
        this.gaps = [];
        return;
      }
      case "doc.study": {
        const target = targetOf(action);
        const block = artifact.blocks.find((candidate) => candidate.id === target);
        if (block) {
          state.read.add(block.id);
          this.gaps = this.gapsFor([block]);
        }
        return;
      }
      case "doc.reread": {
        state.rereads += 1;
        const blocks = this.blocksOf(this.section);
        for (const block of blocks) state.read.add(block.id);
        // A second pass recovers some of what was missed, so only the blocks
        // that are still badly understood remain perceived as gaps.
        this.gaps = this.gapsFor(blocks).slice(0, 1);
        return;
      }
      case "doc.next": {
        this.goTo(Math.min(this.section + 1, artifact.sections.length - 1));
        return;
      }
      case "doc.back": {
        const previous = this.trail.pop();
        this.goTo(previous ?? Math.max(0, this.section - 1), { record: false });
        return;
      }
      case "doc.follow": {
        const target = targetOf(action);
        const block = artifact.blocks.find((candidate) => candidate.id === target);
        const destination = block?.reference ? this.resolveReference(block.reference) : null;
        if (destination !== null) {
          this.goTo(destination);
        } else if (block) {
          // A reference that leads outside the artifact is a dead end here:
          // the reader perceives that they cannot get there from this page.
          this.gaps = [
            {
              type: "comprehension-gap",
              gap: "reference",
              text: `"${truncate(block.text)}" points at ${block.reference ?? "nothing"}, which is not part of this ${artifact.sections[0]?.noun ?? "document"}`,
            },
          ];
        }
        return;
      }
      case "read":
      case "wait":
        return;
      default:
        throw new Error(`humanity surface cannot "${action.verb}"`);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Deprecated web view                                               */
  /* ---------------------------------------------------------------- */

  async snapshot(): Promise<RawSnapshot> {
    const kernel = await this.kernelPercept();
    const percept = webPerceptFromKernel(kernel);
    return {
      url: percept.url,
      title: percept.title,
      viewport: percept.viewport,
      scrollY: percept.scrollY,
      scrollHeight: percept.scrollHeight,
      elements: percept.elements,
      dialogs: percept.dialogs,
      loadingIndicator: false,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    return null;
  }

  async moveMouse(_point: Point): Promise<void> {
    // Reading has no pointer to move.
  }

  /**
   * The legacy gesture path. A click on a document surface is the reader
   * stopping on whatever is at that position — which is `doc.study` — and a
   * click on a section marker is turning the page.
   */
  async clickAt(point: Point): Promise<void> {
    const kernel = await this.kernelPercept();
    const percept = webPerceptFromKernel(kernel);
    const hit = percept.elements.find(
      (element) =>
        element.interactive &&
        point.x >= element.box.x &&
        point.x <= element.box.x + element.box.width &&
        point.y >= element.box.y &&
        point.y <= element.box.y + element.box.height,
    );
    if (!hit) return;
    const affordance = kernel.affordances.find((candidate) => candidate.description === hit.text);
    if (!affordance) return;
    if (affordance.kind === "doc.section") {
      const target = affordance.state.metadata?.section;
      if (typeof target === "number") this.goTo(target);
      return;
    }
    await this.actKernel({ verb: "doc.study", target: affordance.id });
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.clickAt(point);
  }

  async typeText(_text: string, _perCharIntervalMs: number): Promise<void> {
    // Nothing on a document surface accepts input.
  }

  async pressKey(key: string): Promise<void> {
    // The keys a reader actually presses in a document viewer.
    if (key === "PageDown" || key === "ArrowRight" || key === "Space") {
      await this.actKernel({ verb: "doc.next" });
    } else if (key === "PageUp" || key === "ArrowLeft") {
      await this.actKernel({ verb: "doc.back" });
    }
  }

  /** Scrolling past the end of a section turns to the next one. */
  async scrollBy(deltaY: number): Promise<void> {
    await this.actKernel({ verb: deltaY >= 0 ? "doc.next" : "doc.back" });
  }

  async goBack(): Promise<void> {
    await this.actKernel({ verb: "doc.back" });
  }

  async navigate(url: string): Promise<void> {
    await this.open(url, { width: 0, height: 0 });
  }

  async close(): Promise<void> {
    this.artifact = null;
  }

  /* ---------------------------------------------------------------- */
  /* Reading state                                                     */
  /* ---------------------------------------------------------------- */

  private requireArtifact(): Artifact {
    if (!this.artifact) throw new Error("HumanityAdapter: open() an artifact before reading it");
    return this.artifact;
  }

  private recomputeComprehension(): void {
    const artifact = this.requireArtifact();
    const analysis = analyzeComprehension(artifact, this.persona);
    this.comprehension = new Map(analysis.blocks.map((block) => [block.blockId, block]));
  }

  private stateFor(section: number): SectionState {
    const existing = this.sections.get(section);
    if (existing) return existing;
    const created: SectionState = { read: new Set(), skimmed: false, rereads: 0 };
    this.sections.set(section, created);
    return created;
  }

  private blocksOf(section: number): readonly ArtifactBlock[] {
    const artifact = this.requireArtifact();
    return (artifact.sections[section]?.blocks ?? [])
      .map((index) => artifact.blocks[index])
      .filter(isBlock);
  }

  private goTo(section: number, options: { record?: boolean } = {}): void {
    if (options.record !== false) this.trail.push(this.section);
    this.section = section;
    this.gaps = [];
  }

  /** True when the reader has read the last section of the artifact. */
  /**
   * The reader has reached the end and consumed the last section — closely or
   * by skimming it. Skimming counts: someone who skims the last page still
   * knows the document is over, and requiring a close read here stranded
   * skimming personas on the final section, turning them back with `doc.next`
   * against a clamped index until they gave up.
   */
  private atEnd(): boolean {
    const artifact = this.requireArtifact();
    if (this.section !== artifact.sections.length - 1) return false;
    const state = this.sections.get(this.section);
    if (!state) return false;
    return this.isConsumed(this.section, state);
  }

  /** True when the reader has been through every block of a section. */
  private isConsumed(section: number, state: SectionState): boolean {
    if (state.skimmed) return true;
    const blocks = this.blocksOf(section);
    return blocks.length > 0 && blocks.every((block) => state.read.has(block.id));
  }

  /**
   * How much of the artifact the reader has been through — the numerator of
   * the progress a reader feels. A skimmed section counts in full: they have
   * moved past it, whatever they retained of it.
   */
  private blocksRead(): number {
    let total = 0;
    for (const [section, state] of this.sections) {
      total += state.skimmed ? this.blocksOf(section).length : state.read.size;
    }
    return total;
  }

  /**
   * The gaps this reader perceives in a set of blocks they just read.
   *
   * Only genuinely lost blocks surface: a reader knows when they did not
   * follow something, but a paragraph they mostly got does not announce
   * itself. The threshold is what separates "that was dense" from "I have
   * no idea what that said".
   */
  private gapsFor(blocks: readonly ArtifactBlock[]): SurfaceSignal[] {
    const signals: SurfaceSignal[] = [];
    for (const block of blocks) {
      const understanding = this.comprehension.get(block.id);
      if (!understanding || understanding.comprehension >= 0.5) continue;
      const worst = [...understanding.obstacles].sort((a, b) => b.cost - a.cost)[0];
      if (!worst) continue;
      signals.push({
        type: "comprehension-gap",
        gap: GAP_FOR_OBSTACLE[worst.kind] ?? "structure",
        text: worst.evidence,
      });
    }
    return signals.slice(0, 3);
  }

  /** Resolve a cross-reference to a section index, when it points inside. */
  private resolveReference(reference: string): number | null {
    const artifact = this.requireArtifact();
    const anchor = reference.replace(/^#/, "").replace(/[-_]+/g, " ").trim().toLowerCase();
    if (!anchor || /^[a-z]+:/i.test(reference)) return null;
    const index = artifact.sections.findIndex(
      (section) =>
        section.title
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .trim() === anchor,
    );
    return index >= 0 ? index : null;
  }
}

/**
 * The line a reader sees when there is no more. Named for the artifact's own
 * unit — a deck ends after its last slide, a payload after its last record —
 * because "[end of document]" under a pitch deck reads as a bug.
 */
function endMarkerFor(artifact: Artifact | null): string {
  const noun = artifact?.sections[0]?.noun ?? "section";
  switch (noun) {
    case "slide":
      return "[end of slides]";
    case "page":
      return "[end of pages]";
    case "screen":
      return "[end of report]";
    case "record":
      return "[end of payload]";
    default:
      return "[end of document]";
  }
}

const GAP_FOR_OBSTACLE: Record<string, "term" | "reference" | "figure" | "quantity" | "structure"> =
  {
    "undefined-term": "term",
    jargon: "term",
    "unlabeled-figure": "figure",
    "missing-baseline": "quantity",
    "wide-table": "quantity",
    "long-sentence": "structure",
    "wall-of-text": "structure",
    "deep-nesting": "structure",
    "dense-slide": "structure",
    "raw-error": "term",
  };

/** Which blocks are things a reader stops *on*, rather than reads through. */
function affordanceKind(block: ArtifactBlock): string | null {
  switch (block.kind) {
    case "table":
      return "doc.table";
    case "figure":
      return "doc.figure";
    case "metric":
      return "doc.metric";
    case "reference":
      return "doc.reference";
    case "heading":
    case "title":
      return "doc.heading";
    default:
      return null;
  }
}

function toContentBlock(block: ArtifactBlock): ContentBlock {
  const detail: Record<string, unknown> = {};
  if (block.table) detail.table = block.table;
  if (block.metric) detail.metric = block.metric;
  if (block.figure) detail.figure = block.figure;
  if (block.reference) detail.reference = block.reference;
  if (block.language) detail.language = block.language;
  return {
    id: block.id,
    kind: block.kind,
    text: block.text,
    depth: block.depth,
    section: block.section,
    ...(Object.keys(detail).length > 0 ? { detail } : {}),
  };
}

/**
 * The affordance a kernel action names. The session forwards a decision's
 * `payload` to `actKernel` and not its `target`, so cognition puts the
 * affordance id in the payload; both are accepted here so a direct
 * `actKernel` call reads naturally too.
 */
function targetOf(action: KernelAction): string | null {
  if (typeof action.target === "string") return action.target;
  return typeof action.payload === "string" ? action.payload : null;
}

function isBlock(block: ArtifactBlock | undefined): block is ArtifactBlock {
  return block !== undefined;
}

function truncate(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Read an artifact already in memory — the one-liner programmatic path. */
export function humanityAdapterFor(
  address: string,
  text: string,
  options: Omit<HumanityAdapterOptions, "artifact"> = {},
): HumanityAdapter {
  const adapter = new HumanityAdapter(options);
  adapter.openArtifact(
    artifactFromText(address, text, {
      ...(options.format ? { format: options.format } : {}),
      ...(options.genre ? { genre: options.genre } : {}),
    }),
  );
  return adapter;
}
