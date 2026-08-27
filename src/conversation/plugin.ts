/**
 * ConversationPlugin — the judgment the person forms about the thing they
 * were talking to.
 *
 * Runs at session end, once, over the whole transcript rather than per
 * percept, because most of what matters is only visible across turns: a
 * surface asked twice for the same thing, never once admitted a miss, never
 * offered a person. You cannot see any of that from a single reply.
 *
 * Findings land through the ordinary plugin channel, so they are
 * deduplicated, scored into the `conversation.*` dimensions, and rendered in
 * every report exactly like an accessibility or performance finding.
 */

import type { EvePlugin, PluginContext } from "../plugins/plugin.js";
import type { ConversationAdapter } from "./adapter.js";
import { analyzeConversation, type ConversationAnalysis } from "./analysis.js";
import { registerConversationVocabulary } from "./vocabulary.js";

export interface ConversationPluginOptions {
  readonly goal?: string;
}

export class ConversationPlugin implements EvePlugin {
  readonly name = "conversation";

  private analysis: ConversationAnalysis | null = null;

  constructor(
    private readonly adapter: ConversationAdapter,
    private readonly options: ConversationPluginOptions = {},
  ) {}

  onRegister(): void {
    registerConversationVocabulary();
  }

  onSessionEnd(ctx: PluginContext): void {
    // Judging a page on whether it offered a handoff would be a category
    // error, and the scorer would drop the dimensions anyway.
    if (ctx.capabilities.modality !== "conversational") return;

    const turns = this.adapter.transcript();
    if (turns.length === 0) return;

    const analysis = analyzeConversation({
      address: ctx.startUrl,
      kind: this.adapter.kind,
      turns,
      repairAttempts: this.adapter.repairs(),
      persona: ctx.persona,
      // From the context, not a closure the runner sets afterwards: this
      // runs *inside* `session.run()`, so anything assigned from the
      // returned result would still be its initial value here.
      goalAchieved: ctx.goalAchieved,
      goal: this.options.goal ?? "get help",
    });

    this.analysis = analysis;
    for (const finding of analysis.findings) ctx.report(finding);
  }

  /** The analysis this plugin produced, once the session has ended. */
  result(): ConversationAnalysis | null {
    return this.analysis;
  }
}
