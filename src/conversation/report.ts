/**
 * Conversation reports.
 *
 * The session's own HTML/Markdown/JSON reports already render a conversation
 * — findings, scores, the journal — because a conversation is an ordinary
 * session. What they cannot show is the thing specific to dialogue: the
 * transcript, marked up with where it went wrong.
 */

import type { ConversationTurn } from "../core/kernel.js";
import type { ConversationAnalysis } from "./analysis.js";

function bar(fraction: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/**
 * Render the conversation as Markdown: the verdict, then the transcript with
 * the failures marked where they happened.
 *
 * The transcript is the report. A score tells someone their bot is bad; the
 * exchange where a person asked three times and left tells them why, and is
 * the thing that actually gets forwarded to whoever can fix it.
 */
export function renderConversationMarkdown(
  analysis: ConversationAnalysis,
  turns: readonly ConversationTurn[],
): string {
  const lines: string[] = [];

  lines.push(`# Conversation report — ${analysis.address}`);
  lines.push("");
  lines.push(
    `**${analysis.persona}** talked to a ${analysis.kind} surface for ${analysis.turnCount} turn(s), asking ${analysis.operatorTurns} time(s).`,
  );
  lines.push("");
  lines.push("| | |");
  lines.push("| --- | --- |");
  lines.push(
    `| Understood the person | \`${bar(analysis.understanding / 100, 12)}\` **${analysis.understanding}/100** |`,
  );
  lines.push(
    `| Showed it understood | \`${bar(analysis.grounding / 100, 12)}\` **${analysis.grounding}/100** |`,
  );
  lines.push(
    `| Recovered when it failed | \`${bar(analysis.recovery / 100, 12)}\` **${analysis.recovery}/100** |`,
  );
  lines.push(`| Had to rephrase | ${analysis.repairAttempts}× |`);
  lines.push(
    `| Missed the question | ${analysis.admittedMisses} admitted, **${analysis.silentMisses} silently** |`,
  );
  lines.push(`| Offered a person | ${analysis.everOfferedHandoff ? "yes" : "**never**"} |`);
  if (analysis.meanLatencyMs !== null) {
    lines.push(
      `| Reply time | mean ${(analysis.meanLatencyMs / 1000).toFixed(1)}s, slowest ${((analysis.maxLatencyMs ?? 0) / 1000).toFixed(1)}s |`,
    );
  }
  lines.push("");

  /* ---- the transcript ---- */
  lines.push("## Transcript");
  lines.push("");
  for (const turn of turns) {
    const who = turn.speaker === "operator" ? `**${analysis.persona}**` : "**Assistant**";
    const timing =
      turn.latencyMs !== undefined && turn.latencyMs >= 1000
        ? ` _(${(turn.latencyMs / 1000).toFixed(1)}s)_`
        : "";
    lines.push(`- ${who}${timing}: ${turn.text.replace(/\n+/g, " ")}`);
  }
  lines.push("");

  /* ---- findings ---- */
  if (analysis.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const finding of analysis.findings) {
      lines.push(`### [${finding.severity}] ${finding.title}`);
      lines.push("");
      lines.push(finding.description);
      lines.push("");
      for (const evidence of finding.evidence) lines.push(`- ${evidence}`);
      if (finding.recommendation) {
        lines.push("");
        lines.push(`**Fix:** ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
