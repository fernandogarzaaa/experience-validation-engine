/**
 * Shared assembly for readers: accumulate blocks, group them into sections,
 * and mint stable block ids.
 *
 * Every reader faces the same two chores — "start a new section here" and
 * "append a block to whatever section is open" — and getting the section
 * bookkeeping subtly wrong in six places would silently corrupt reading
 * order, which is the one thing a document surface has instead of geometry.
 */

import type {
  Artifact,
  ArtifactBlock,
  ArtifactFormat,
  ArtifactGenre,
  ArtifactSection,
  BlockKind,
  SectionNoun,
} from "../types.js";
import { sectionNounFor } from "../types.js";

export interface BlockInput {
  readonly kind: BlockKind;
  readonly text: string;
  readonly depth?: number;
  readonly table?: ArtifactBlock["table"];
  readonly metric?: ArtifactBlock["metric"];
  readonly figure?: ArtifactBlock["figure"];
  readonly reference?: string;
  readonly language?: string;
}

export class ArtifactBuilder {
  private readonly blocks: ArtifactBlock[] = [];
  private readonly sections: { title: string; blocks: number[] }[] = [];
  private readonly meta: Record<string, string> = {};
  private title: string | null = null;

  constructor(
    private readonly address: string,
    private readonly format: ArtifactFormat,
    private genre: ArtifactGenre,
  ) {}

  setGenre(genre: ArtifactGenre): void {
    this.genre = genre;
  }

  setTitle(title: string): void {
    if (!this.title && title.trim()) this.title = title.trim();
  }

  setMeta(key: string, value: string): void {
    this.meta[key] = value;
  }

  /**
   * Open a new section. Sections are the unit a reader turns between — a
   * chapter, a slide, a dashboard panel — so an empty one is never opened
   * speculatively: the current section is reused until something lands in it.
   */
  startSection(title: string): void {
    const current = this.sections.at(-1);
    if (current && current.blocks.length === 0) {
      current.title = title || current.title;
      return;
    }
    this.sections.push({ title, blocks: [] });
  }

  /**
   * Name the open section if it does not have a title yet. Slides are cut by
   * their separator, so the heading that follows the cut is what names them.
   */
  nameCurrentSection(title: string): void {
    const current = this.sections.at(-1);
    if (current && !current.title.trim()) current.title = title;
  }

  add(block: BlockInput): void {
    const text = block.text.replace(/\s+$/, "");
    // A block with neither text nor structured content is not perceivable.
    if (!text.trim() && !block.table && !block.metric && !block.figure) return;
    if (this.sections.length === 0) this.sections.push({ title: "", blocks: [] });
    const sectionIndex = this.sections.length - 1;
    const index = this.blocks.length;
    this.blocks.push({
      id: `b${index}`,
      kind: block.kind,
      text,
      depth: block.depth ?? 0,
      section: sectionIndex,
      ...(block.table ? { table: block.table } : {}),
      ...(block.metric ? { metric: block.metric } : {}),
      ...(block.figure ? { figure: block.figure } : {}),
      ...(block.reference ? { reference: block.reference } : {}),
      ...(block.language ? { language: block.language } : {}),
    });
    this.sections[sectionIndex]?.blocks.push(index);
  }

  /** How many blocks have been added so far (readers use it for lookahead). */
  get size(): number {
    return this.blocks.length;
  }

  /** The title so far — set explicitly, or derived from the address. */
  get currentTitle(): string {
    return this.title ?? deriveTitle(this.address);
  }

  build(): Artifact {
    const noun: SectionNoun = sectionNounFor(this.genre);
    const sections: ArtifactSection[] = this.sections
      .filter((s) => s.blocks.length > 0)
      .map((s, index) => ({
        index,
        title: s.title.trim() || `${capitalize(noun)} ${index + 1}`,
        noun,
        blocks: s.blocks,
      }));

    // Filtering empty sections renumbers the survivors, so block→section
    // links are rewritten rather than left pointing at the old indices.
    const remap = new Map<number, number>();
    sections.forEach((section, newIndex) => {
      for (const blockIndex of section.blocks) remap.set(blockIndex, newIndex);
    });
    const blocks = this.blocks.map((block, index) => ({
      ...block,
      section: remap.get(index) ?? 0,
    }));

    return {
      address: this.address,
      title: this.title ?? deriveTitle(this.address),
      format: this.format,
      genre: this.genre,
      sections: sections.length > 0 ? sections : [{ index: 0, title: "Empty", noun, blocks: [] }],
      blocks,
      meta: { ...this.meta },
    };
  }
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Last path segment, minus extension — what a reader would call the thing. */
function deriveTitle(address: string): string {
  const name = address.split(/[\\/]/).pop() ?? address;
  return name.replace(/\.[a-z0-9]+$/i, "") || address;
}
