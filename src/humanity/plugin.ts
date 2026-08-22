/**
 * ComprehensionPlugin — the reader's account of what they understood.
 *
 * The session loop already records what the reader *did*: which sections they
 * read, where they went back, where they gave up. This plugin contributes the
 * other half, the judgment a reader forms about the artifact itself — the term
 * that was never defined, the figure with no caption, the number with nothing
 * to compare against, the ending that asked for nothing.
 *
 * It runs at session end, once, over the whole artifact rather than per
 * percept, because comprehension is not a property of one screen: an acronym
 * is only undefined if the artifact never defines it *anywhere*, which is a
 * question you can only answer having seen all of it. The findings land in the
 * session through the ordinary plugin channel, so they are deduplicated,
 * scored into the `humanity.*` dimensions, and rendered in every report
 * exactly like an accessibility or performance finding.
 */

import type { EvePlugin, PluginContext } from "../plugins/plugin.js";
import type { HumanityAdapter } from "./adapter.js";
import { analyzeComprehension, type ComprehensionAnalysis } from "./comprehension.js";
import type { Artifact } from "./types.js";
import { registerHumanityVocabulary } from "./vocabulary.js";

export class ComprehensionPlugin implements EvePlugin {
  readonly name = "comprehension";

  private analysis: ComprehensionAnalysis | null = null;

  /**
   * `source` is either the artifact itself or the adapter reading it. The
   * adapter form is the normal one: the artifact does not exist until
   * `open()` has run, which is after plugins are registered.
   */
  constructor(private readonly source: Artifact | HumanityAdapter) {}

  onRegister(): void {
    registerHumanityVocabulary();
  }

  onSessionEnd(ctx: PluginContext): void {
    // A reading judgment about a live page would be a category error: the
    // dimensions are document-only, and the session scorer would drop them.
    if (ctx.capabilities.modality !== "document") return;

    const artifact = this.resolveArtifact();
    if (!artifact) return;

    const analysis = analyzeComprehension(artifact, ctx.persona);
    this.analysis = analysis;
    for (const finding of analysis.findings) ctx.report(finding);
  }

  /** The analysis this plugin produced, once the session has ended. */
  result(): ComprehensionAnalysis | null {
    return this.analysis;
  }

  private resolveArtifact(): Artifact | null {
    if ("currentArtifact" in this.source && typeof this.source.currentArtifact === "function") {
      return this.source.currentArtifact();
    }
    return this.source as Artifact;
  }
}
