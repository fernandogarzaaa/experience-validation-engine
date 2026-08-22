/**
 * Reading reports.
 *
 * The session's own HTML/Markdown/JSON reports already render a reading
 * session — findings, scores, the journal, the emotion timeline — because a
 * reading session is an ordinary session. What they cannot show is the thing
 * specific to reading: where in the artifact this reader's understanding
 * fell away. That is what this adds.
 */

import type { ComprehensionAnalysis } from "./comprehension.js";
import type { Artifact } from "./types.js";
import { artifactWordCount, wordCount } from "./types.js";

/** Minutes, as a reader would state them. */
function minutes(ms: number): string {
  const value = ms / 60_000;
  if (value < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  return `${value.toFixed(1)} min`;
}

function bar(fraction: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/**
 * Render the comprehension analysis as Markdown.
 *
 * Ordered the way the reader met the artifact — the verdict, then where
 * understanding broke down, then the evidence — rather than by severity,
 * because "which part lost me" is the question a writer is actually asking.
 */
export function renderComprehensionMarkdown(
  analysis: ComprehensionAnalysis,
  artifact: Artifact,
): string {
  const lines: string[] = [];
  const blocksById = new Map(artifact.blocks.map((block) => [block.id, block]));

  lines.push(`# Reading report — ${artifact.title}`);
  lines.push("");
  lines.push(
    `**${analysis.persona}** read \`${artifact.address}\` — a ${artifact.genre} of ${artifact.sections.length} ${artifact.sections[0]?.noun ?? "section"}(s), ${artifactWordCount(artifact)} words.`,
  );
  lines.push("");
  lines.push("| | |");
  lines.push("| --- | --- |");
  lines.push(`| Understood | **${analysis.comprehensionScore}/100** |`);
  lines.push(`| Reading time | ${minutes(analysis.readingTimeMs)} at this persona's pace |`);
  lines.push(
    `| Reading ease | Flesch ${analysis.readability.fleschReadingEase} (grade ${analysis.readability.gradeLevel}) |`,
  );
  lines.push(
    `| Sentences | ${analysis.readability.sentences}, mean ${analysis.readability.meanSentenceWords} words, longest ${analysis.readability.longestSentenceWords} |`,
  );
  lines.push("");

  /* ---- where understanding fell away ---- */
  const lost = analysis.blocks
    .filter((block) => block.comprehension < 0.7)
    .sort((a, b) => a.comprehension - b.comprehension)
    .slice(0, 10);

  lines.push("## Where the reader lost the thread");
  lines.push("");
  if (lost.length === 0) {
    lines.push("Nothing in this artifact dropped below 70% comprehension for this reader.");
  } else {
    for (const block of lost) {
      const source = blocksById.get(block.blockId);
      const section = source ? artifact.sections[source.section] : undefined;
      lines.push(
        `- \`${bar(block.comprehension, 12)}\` **${Math.round(block.comprehension * 100)}%** — ${section?.noun ?? "section"} "${section?.title ?? "?"}"`,
      );
      lines.push(`  > ${truncate(source?.text ?? "", 200)}`);
      for (const obstacle of block.obstacles) {
        lines.push(`  - _${obstacle.kind}_: ${obstacle.evidence}`);
      }
    }
  }
  lines.push("");

  /* ---- terminology ---- */
  const undefinedTerms = analysis.acronyms.filter((use) => !use.introduced);
  if (undefinedTerms.length > 0) {
    lines.push("## Terms never defined");
    lines.push("");
    for (const use of undefinedTerms) {
      lines.push(`- **${use.acronym}** — first appears in: ${truncate(use.firstSeenIn, 140)}`);
    }
    lines.push("");
  }

  /* ---- section map ---- */
  lines.push("## Reading map");
  lines.push("");
  lines.push(`| ${capitalize(artifact.sections[0]?.noun ?? "section")} | Words | Understood |`);
  lines.push("| --- | ---: | --- |");
  const byBlockId = new Map(analysis.blocks.map((block) => [block.blockId, block]));
  for (const section of artifact.sections) {
    let weighted = 0;
    let weight = 0;
    let words = 0;
    for (const index of section.blocks) {
      const block = artifact.blocks[index];
      if (!block) continue;
      const blockWords = Math.max(wordCount(block.text), 1);
      words += wordCount(block.text);
      weighted += (byBlockId.get(block.id)?.comprehension ?? 1) * blockWords;
      weight += blockWords;
    }
    const understood = weight > 0 ? weighted / weight : 1;
    lines.push(
      `| ${section.index + 1}. ${section.title} | ${words} | \`${bar(understood, 10)}\` ${Math.round(understood * 100)}% |`,
    );
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

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
