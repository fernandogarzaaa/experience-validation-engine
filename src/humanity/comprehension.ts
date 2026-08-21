/**
 * The comprehension model — what actually happens when a person reads.
 *
 * EVE's browser operator asks "can I do this?". A reader asks a different
 * question — "do I understand this, and do I know what to do now?" — and it
 * fails in its own ways. Nobody bounces off a report because a button was
 * 3px too small. They bounce off it because the third paragraph used a term
 * the first eleven pages never defined, because the number that mattered had
 * nothing to compare against, because the slide had forty words on it, or
 * because they got to the end and still did not know what they were supposed
 * to do.
 *
 * Two things happen here:
 *
 * 1. **Per block**, a reader with this persona's reading speed, tech
 *    literacy and thoroughness either follows it or does not. Comprehension
 *    is a probability, not a verdict, and it is a *product* of independent
 *    obstacles — long sentences, undefined terms, missing baselines — which
 *    is why three small problems in one paragraph lose a reader that one
 *    large one would not.
 * 2. **Across the artifact**, expectations are checked against the genre.
 *    Those checks are the findings, and each one carries the text that
 *    caused it, because a comprehension claim with no quotation is exactly
 *    the vibes-based judgment EVE's evidence rule exists to prevent.
 */

import { clamp01 } from "../core/random.js";
import type { Finding } from "../core/types.js";
import type { Persona } from "../personas/persona.js";
import { readingTimeMs } from "../personas/persona.js";
import {
  type AcronymUse,
  findAcronyms,
  findJargon,
  measureReadability,
  type ReadabilityMetrics,
  splitSentences,
} from "./readability.js";
import type { Artifact, ArtifactBlock, ArtifactGenre, TableDetail } from "./types.js";
import { wordCount } from "./types.js";

/* ------------------------------------------------------------------ */
/* Thresholds — every one of them a claim about human reading           */
/* ------------------------------------------------------------------ */

/** Past ~25 words a sentence outruns the reader's parse buffer. */
const LONG_SENTENCE_WORDS = 25;
/** A paragraph past this length is a wall; the eye stops finding its place. */
const WALL_OF_TEXT_WORDS = 150;
/** Slides are read in seconds. Past this, the audience reads instead of listens. */
const DENSE_SLIDE_WORDS = 60;
/** More bullets than working memory holds is a list nobody retains. */
const MAX_SLIDE_BULLETS = 6;
/** Columns a reader can compare across without losing the row. */
const WIDE_TABLE_COLUMNS = 7;
/** Prose this long with no heading gives the reader nowhere to re-enter. */
const UNSTRUCTURED_WORDS = 400;
/** Flesch below this is professional/academic register, not general prose. */
const HARD_PROSE_FLESCH = 40;
/** Nesting past this and a reader has lost which object they are inside. */
const DEEP_NESTING = 5;

/* ------------------------------------------------------------------ */
/* Per-block comprehension                                             */
/* ------------------------------------------------------------------ */

/** One reason a reader did not fully follow a block. */
export interface ComprehensionObstacle {
  readonly kind:
    | "long-sentence"
    | "undefined-term"
    | "jargon"
    | "wall-of-text"
    | "unlabeled-figure"
    | "missing-baseline"
    | "wide-table"
    | "deep-nesting"
    | "dense-slide"
    | "raw-error";
  /** How much of the reader's grasp this costs, 0..1. */
  readonly cost: number;
  /** The text that caused it — the evidence behind any finding downstream. */
  readonly evidence: string;
}

export interface BlockComprehension {
  readonly blockId: string;
  /** Probability this reader followed the block, 0..1. */
  readonly comprehension: number;
  /** How much of the reader's capacity the block consumed, 0..1. */
  readonly effort: number;
  /** Simulated reading time for this persona, in ms. */
  readonly readingTimeMs: number;
  readonly obstacles: readonly ComprehensionObstacle[];
  readonly readability: ReadabilityMetrics;
}

/**
 * How much benefit of the doubt this reader gives unfamiliar terminology.
 * A specialist skims past `idempotent`; a first-time user does not.
 */
function domainTolerance(persona: Persona): number {
  return clamp01(persona.traits.techLiteracy * 0.7 + persona.traits.baseConfidence * 0.3);
}

/** Read one block as this persona, given what the artifact defined earlier. */
export function comprehendBlock(
  block: ArtifactBlock,
  persona: Persona,
  context: { readonly undefinedAcronyms: ReadonlySet<string>; readonly genre: ArtifactGenre },
): BlockComprehension {
  const readability = measureReadability(block.text);
  const words = wordCount(block.text);
  const tolerance = domainTolerance(persona);
  const obstacles: ComprehensionObstacle[] = [];

  // Sentences that outrun the parse buffer. Code and tables are not prose,
  // so sentence length is meaningless there and is not measured.
  if (block.kind !== "code" && block.kind !== "table") {
    for (const sentence of splitSentences(block.text)) {
      const length = wordCount(sentence);
      if (length > LONG_SENTENCE_WORDS) {
        obstacles.push({
          kind: "long-sentence",
          cost:
            clamp01((length - LONG_SENTENCE_WORDS) / 40) * (1 - persona.traits.thoroughness * 0.4),
          evidence: truncate(sentence),
        });
      }
    }
  }

  // Terms the artifact never introduced. Cost scales down with literacy but
  // never to zero — an expert still stops at an acronym from another domain.
  for (const acronym of collectAcronyms(block.text)) {
    if (!context.undefinedAcronyms.has(acronym)) continue;
    obstacles.push({
      kind: "undefined-term",
      cost: 0.25 * (1 - tolerance * 0.7),
      evidence: `"${acronym}" is used without ever being expanded`,
    });
  }

  const jargon = findJargon(block.text);
  if (jargon.length > 0 && words > 0) {
    const density = jargon.length / Math.max(words, 1);
    obstacles.push({
      kind: "jargon",
      cost: clamp01(density * 6) * (1 - tolerance),
      evidence: `jargon: ${jargon.slice(0, 5).join(", ")}`,
    });
  }

  if (block.kind === "paragraph" && words > WALL_OF_TEXT_WORDS) {
    obstacles.push({
      kind: "wall-of-text",
      cost: clamp01((words - WALL_OF_TEXT_WORDS) / 250),
      evidence: `${words}-word paragraph with no break`,
    });
  }

  if (block.figure && !block.figure.alt && !block.figure.caption) {
    obstacles.push({
      kind: "unlabeled-figure",
      cost: 0.5,
      evidence: `figure ${block.figure.source ?? "(inline)"} carries no caption or alternative text`,
    });
  }

  if (block.metric && !block.metric.baseline && context.genre === "analytics") {
    obstacles.push({
      kind: "missing-baseline",
      cost: 0.35,
      evidence: `"${block.metric.label}: ${block.metric.value}" — compared to what?`,
    });
  }

  if (block.table && block.table.columns.length > WIDE_TABLE_COLUMNS) {
    obstacles.push({
      kind: "wide-table",
      cost: clamp01((block.table.columns.length - WIDE_TABLE_COLUMNS) / 10),
      evidence: `${block.table.columns.length}-column table`,
    });
  }

  if (block.depth > DEEP_NESTING) {
    obstacles.push({
      kind: "deep-nesting",
      cost: clamp01((block.depth - DEEP_NESTING) / 6),
      evidence: `nested ${block.depth} levels deep`,
    });
  }

  if (block.kind === "error") {
    obstacles.push({
      kind: "raw-error",
      cost: 0.3 * (1 - tolerance),
      evidence: truncate(block.text),
    });
  }

  // Register: hard prose costs comprehension in proportion to how far below
  // plain English it sits, discounted by this reader's literacy.
  const registerCost =
    readability.words >= 25 && readability.fleschReadingEase < HARD_PROSE_FLESCH
      ? clamp01((HARD_PROSE_FLESCH - readability.fleschReadingEase) / 60) * (1 - tolerance * 0.6)
      : 0;

  // Obstacles compound multiplicatively: each one is an independent chance
  // of losing the thread, which is why several small ones are worse than the
  // sum of their parts.
  let comprehension = 1 - registerCost;
  for (const obstacle of obstacles) comprehension *= 1 - clamp01(obstacle.cost);

  const effort = clamp01(
    words / 200 + obstacles.reduce((total, o) => total + o.cost, 0) * 0.4 + registerCost * 0.3,
  );

  return {
    blockId: block.id,
    comprehension: clamp01(comprehension),
    effort,
    readingTimeMs: readingTimeMs(persona, words),
    obstacles,
    readability,
  };
}

/* ------------------------------------------------------------------ */
/* Artifact-level analysis                                             */
/* ------------------------------------------------------------------ */

export interface ComprehensionAnalysis {
  readonly artifact: string;
  readonly genre: ArtifactGenre;
  readonly persona: string;
  /** Mean per-block comprehension, weighted by words read. 0..100. */
  readonly comprehensionScore: number;
  /** Reading time for the whole artifact at this persona's pace, in ms. */
  readonly readingTimeMs: number;
  readonly readability: ReadabilityMetrics;
  readonly blocks: readonly BlockComprehension[];
  readonly acronyms: readonly AcronymUse[];
  /** Findings, in EVE's normal shape minus the fields the session assigns. */
  readonly findings: readonly Omit<Finding, "id" | "timestamp">[];
}

/**
 * Read the whole artifact as this persona and report the experience.
 *
 * Pure and deterministic: the same artifact and persona always produce the
 * same analysis, so it can be asserted on in tests and diffed across builds
 * the way `eve trends` diffs sessions.
 */
export function analyzeComprehension(artifact: Artifact, persona: Persona): ComprehensionAnalysis {
  const passages = artifact.blocks.map((block) => block.text);
  const acronyms = findAcronyms(passages);
  const undefinedAcronyms = new Set(
    acronyms.filter((use) => !use.introduced).map((use) => use.acronym),
  );

  const blocks = artifact.blocks.map((block) =>
    comprehendBlock(block, persona, { undefinedAcronyms, genre: artifact.genre }),
  );

  const prose = artifact.blocks
    .filter((block) => block.kind !== "code" && block.kind !== "table")
    .map((block) => block.text)
    .join("\n\n");
  const readability = measureReadability(prose);

  let weighted = 0;
  let weight = 0;
  let readingTimeMs = 0;
  artifact.blocks.forEach((block, index) => {
    const words = Math.max(wordCount(block.text), 1);
    const comprehension = blocks[index]?.comprehension ?? 1;
    weighted += comprehension * words;
    weight += words;
    readingTimeMs += blocks[index]?.readingTimeMs ?? 0;
  });

  return {
    artifact: artifact.address,
    genre: artifact.genre,
    persona: persona.name,
    comprehensionScore: Math.round((weight > 0 ? weighted / weight : 1) * 100),
    readingTimeMs: Math.round(readingTimeMs),
    readability,
    blocks,
    acronyms,
    findings: collectFindings(artifact, persona, blocks, acronyms, readability),
  };
}

function collectFindings(
  artifact: Artifact,
  persona: Persona,
  blocks: readonly BlockComprehension[],
  acronyms: readonly AcronymUse[],
  readability: ReadabilityMetrics,
): readonly Omit<Finding, "id" | "timestamp">[] {
  const findings: Omit<Finding, "id" | "timestamp">[] = [];
  const url = artifact.address;
  const byId = new Map(artifact.blocks.map((block) => [block.id, block]));

  /* ---- undefined terminology ---------------------------------------- */
  const undefinedAcronyms = acronyms.filter((use) => !use.introduced);
  if (undefinedAcronyms.length > 0) {
    findings.push({
      severity: undefinedAcronyms.length >= 4 ? "major" : "minor",
      category: "humanity.comprehension",
      title: `${undefinedAcronyms.length} term(s) used without ever being defined`,
      description:
        "The artifact assumes the reader already knows these. A reader who does not has no way to recover the meaning from the text, and every later sentence that depends on the term is lost with it.",
      evidence: undefinedAcronyms
        .slice(0, 5)
        .map((use) => `"${use.acronym}" first appears in: ${truncate(use.firstSeenIn)}`),
      url,
      recommendation:
        'Expand each term on first use — "Service Level Objective (SLO)" — or drop it for a phrase the audience already has.',
    });
  }

  /* ---- register ------------------------------------------------------ */
  if (readability.words >= 100 && readability.fleschReadingEase < HARD_PROSE_FLESCH) {
    findings.push({
      severity: readability.fleschReadingEase < 25 ? "major" : "minor",
      category: "humanity.readability",
      title: `Prose reads at grade ${readability.gradeLevel} (Flesch ${readability.fleschReadingEase})`,
      description:
        "Sentences are long and words are heavy enough that the reader has to hold each clause open while parsing the next. That cost is paid on every sentence, so it compounds across the whole artifact.",
      evidence: [
        `${readability.sentences} sentences, mean ${readability.meanSentenceWords} words, longest ${readability.longestSentenceWords}`,
        `${Math.round(readability.complexWordRatio * 100)}% of words are three syllables or more`,
      ],
      url,
      recommendation:
        "Split sentences past ~25 words and replace multi-syllable abstractions with the concrete thing they stand for.",
    });
  }

  /* ---- structure ----------------------------------------------------- */
  const headings = artifact.blocks.filter(
    (block) => block.kind === "heading" || block.kind === "title",
  );
  const totalWords = artifact.blocks.reduce((total, block) => total + wordCount(block.text), 0);
  if (totalWords > UNSTRUCTURED_WORDS && headings.length === 0) {
    findings.push({
      severity: "major",
      category: "humanity.structure",
      title: `${totalWords} words with no headings at all`,
      description:
        "There is no way to scan this, no way to find one part again, and no way back in after an interruption. Readers who cannot scan do not read more slowly — they stop.",
      evidence: [
        `${artifact.blocks.length} blocks across ${artifact.sections.length} section(s), 0 headings`,
      ],
      url,
      recommendation: "Break the text into titled sections a reader can navigate and return to.",
    });
  }

  /* ---- walls of text -------------------------------------------------- */
  const walls = blocks.filter((block) =>
    block.obstacles.some((obstacle) => obstacle.kind === "wall-of-text"),
  );
  if (walls.length > 0) {
    findings.push({
      severity: walls.length >= 3 ? "major" : "minor",
      category: "humanity.structure",
      title: `${walls.length} paragraph(s) run past ${WALL_OF_TEXT_WORDS} words`,
      description:
        "In an unbroken block the eye loses its place on line return, and re-finding it costs the reader the sentence they were holding.",
      evidence: walls
        .slice(0, 3)
        .map((block) => truncate(byId.get(block.blockId)?.text ?? block.blockId)),
      url,
      recommendation:
        "Break each into paragraphs of one idea, or lift the list that is hiding inside it.",
    });
  }

  /* ---- figures -------------------------------------------------------- */
  const unlabeledFigures = artifact.blocks.filter(
    (block) => block.figure && !block.figure.alt && !block.figure.caption,
  );
  if (unlabeledFigures.length > 0) {
    findings.push({
      severity: "major",
      category: "humanity.comprehension",
      title: `${unlabeledFigures.length} figure(s) carry no caption or alternative text`,
      description:
        "A chart with no caption asserts nothing: the reader has to infer the claim from the picture, and a reader using a screen reader gets no claim at all.",
      evidence: unlabeledFigures
        .slice(0, 4)
        .map(
          (block) =>
            `figure ${block.figure?.source ?? "(inline)"} in ${sectionName(artifact, block)}`,
        ),
      url,
      recommendation:
        'Caption every figure with the takeaway, not the subject: "Signups fell 12% after the March release", not "Signup chart".',
    });
  }

  /* ---- genre expectations --------------------------------------------- */
  findings.push(...genreFindings(artifact, persona, blocks, byId));

  return findings;
}

/**
 * Genre is where reading expectations live. The same paragraph is fine in a
 * report, fatal on a slide, and beside the point in a stack trace.
 */
function genreFindings(
  artifact: Artifact,
  persona: Persona,
  blocks: readonly BlockComprehension[],
  byId: ReadonlyMap<string, ArtifactBlock>,
): readonly Omit<Finding, "id" | "timestamp">[] {
  const findings: Omit<Finding, "id" | "timestamp">[] = [];
  const url = artifact.address;

  switch (artifact.genre) {
    case "presentation": {
      const dense = artifact.sections.filter((section) => {
        const words = section.blocks.reduce(
          (total, index) => total + wordCount(artifact.blocks[index]?.text ?? ""),
          0,
        );
        const bullets = section.blocks.filter(
          (index) => artifact.blocks[index]?.kind === "list-item",
        ).length;
        return words > DENSE_SLIDE_WORDS || bullets > MAX_SLIDE_BULLETS;
      });
      if (dense.length > 0) {
        findings.push({
          severity: dense.length >= artifact.sections.length / 2 ? "major" : "minor",
          category: "humanity.structure",
          title: `${dense.length} of ${artifact.sections.length} slides are too dense to read at slide pace`,
          description:
            "An audience given more than about sixty words reads the slide instead of listening to the speaker, and finishes doing neither.",
          evidence: dense.slice(0, 4).map((section) => {
            const words = section.blocks.reduce(
              (total, index) => total + wordCount(artifact.blocks[index]?.text ?? ""),
              0,
            );
            return `"${section.title}" — ${words} words, ${section.blocks.length} blocks`;
          }),
          url,
          recommendation: "One claim per slide; move the supporting detail into the notes.",
        });
      }

      const labelTitles = artifact.sections.filter((section) => isLabelTitle(section.title));
      if (labelTitles.length >= Math.max(2, artifact.sections.length / 2)) {
        findings.push({
          severity: "minor",
          category: "humanity.comprehension",
          title: `${labelTitles.length} slide titles name a topic instead of making a point`,
          description:
            'A title like "Results" tells the reader where they are but not what to conclude. Skimmed later — which is how most decks are read — the deck says nothing.',
          evidence: labelTitles.slice(0, 5).map((section) => `"${section.title}"`),
          url,
          recommendation:
            'Make each title the sentence you want remembered: "Retention recovered in Q3" rather than "Retention".',
        });
      }
      break;
    }

    case "analytics": {
      const nakedMetrics = artifact.blocks.filter(
        (block) => block.metric && !block.metric.baseline,
      );
      if (nakedMetrics.length > 0) {
        findings.push({
          severity: nakedMetrics.length >= 3 ? "major" : "minor",
          category: "humanity.comprehension",
          title: `${nakedMetrics.length} number(s) presented with nothing to compare against`,
          description:
            "A figure with no baseline cannot be judged good or bad, so the reader either invents a comparison or ignores the number. Both outcomes are worse than not reporting it.",
          evidence: nakedMetrics
            .slice(0, 5)
            .map((block) => `${block.metric?.label}: ${block.metric?.value}`),
          url,
          recommendation:
            "Pair every number with its comparison — previous period, target, or the same number for a peer.",
        });
      }

      // A table of numbers is the commonest analytics artifact of all, and
      // it fails the same way a naked metric does: a column headed "revenue"
      // holding 600000 is dollars, or cents, or thousands, and the reader has
      // no way to tell which.
      for (const block of artifact.blocks) {
        if (!block.table) continue;
        const bare = block.table.columns.filter(
          (column, index) => !columnDeclaresUnit(column) && columnIsNumeric(block.table, index),
        );
        if (bare.length === 0) continue;
        findings.push({
          severity: bare.length >= 3 ? "major" : "minor",
          category: "humanity.comprehension",
          title: `${bare.length} numeric column(s) carry no unit in the header`,
          description:
            "The reader has to infer the unit from the magnitude, which is a guess — and a guess about whether a latency figure is milliseconds or seconds is the difference between fine and an outage.",
          evidence: bare.slice(0, 5).map((column) => {
            const index = block.table?.columns.indexOf(column) ?? 0;
            const sample = block.table?.rows[0]?.[index] ?? "";
            return `"${column}" — e.g. ${sample}`;
          }),
          url,
          recommendation:
            'Put the unit in the header — "revenue (USD)", "p99 (ms)", "error rate (%)".',
        });
      }

      const unitless = artifact.blocks.filter(
        (block) => block.metric && !block.metric.unit && !/[%$£€¥]/.test(block.metric.value),
      );
      if (unitless.length >= 3) {
        findings.push({
          severity: "minor",
          category: "humanity.comprehension",
          title: `${unitless.length} number(s) carry no unit`,
          description:
            "The reader has to guess whether 4200 is dollars, users, milliseconds or requests — and a guess that lands wrong is worse than a blank.",
          evidence: unitless
            .slice(0, 5)
            .map((block) => `${block.metric?.label}: ${block.metric?.value}`),
          url,
          recommendation: "State the unit next to the number, in the label or the value.",
        });
      }
      break;
    }

    case "transcript": {
      const errors = artifact.blocks.filter((block) => block.kind === "error");
      const withoutRemedy = errors.filter((block) => !suggestsRemedy(block.text));
      if (withoutRemedy.length > 0) {
        findings.push({
          severity: withoutRemedy.length >= 3 ? "major" : "minor",
          category: "humanity.comprehension",
          title: `${withoutRemedy.length} error(s) state what failed but not what to do`,
          description:
            "This is the moment the reader is most stuck and least patient. An error that names a cause without a next step leaves them searching the web instead of fixing the problem.",
          evidence: withoutRemedy.slice(0, 4).map((block) => truncate(block.text)),
          url,
          recommendation:
            "Follow each failure with the next action — the flag to pass, the file to edit, the command to run.",
        });
      }
      break;
    }

    case "data": {
      const deepest = Math.max(0, ...artifact.blocks.map((block) => block.depth));
      if (deepest > DEEP_NESTING) {
        findings.push({
          severity: "minor",
          category: "humanity.structure",
          title: `Payload nests ${deepest} levels deep`,
          description:
            "Past about five levels the reader can no longer say which object a field belongs to without scrolling back, so every field is read twice.",
          evidence: artifact.blocks
            .filter((block) => block.depth > DEEP_NESTING)
            .slice(0, 4)
            .map((block) => truncate(block.text)),
          url,
          recommendation: "Flatten the response, or document the shape beside it.",
        });
      }
      break;
    }

    case "interface": {
      const undocumented = artifact.blocks.filter(
        (block) => block.kind === "field" && !/—|:|\s{2,}/.test(block.text),
      );
      if (undocumented.length >= 3) {
        findings.push({
          severity: "minor",
          category: "humanity.comprehension",
          title: `${undocumented.length} option(s) listed with no explanation`,
          description:
            "A flag with no description forces the reader to try it and see, which is the experiment they came to this text to avoid.",
          evidence: undocumented.slice(0, 5).map((block) => truncate(block.text)),
          url,
          recommendation: "Give every option a one-line description of what it does.",
        });
      }
      break;
    }

    case "document": {
      // Where the point lives. A reader who has to reach the last fifth to
      // learn the conclusion has already decided whether to keep going.
      const conclusion = findConclusionIndex(artifact);
      if (conclusion !== null && artifact.blocks.length >= 8) {
        const position = conclusion / artifact.blocks.length;
        if (position > 0.75) {
          findings.push({
            severity: "minor",
            category: "humanity.structure",
            title: "The conclusion arrives in the last quarter of the document",
            description:
              "Readers decide whether to continue in the first screen. A recommendation held back to the end reaches only the readers who never needed convincing.",
            evidence: [
              `conclusion at block ${conclusion + 1} of ${artifact.blocks.length}: ${truncate(
                artifact.blocks[conclusion]?.text ?? "",
              )}`,
            ],
            url,
            recommendation: "Lead with the conclusion, then support it.",
          });
        }
      }
      break;
    }
  }

  // Every genre: what does the reader do now? Prose and decks are supposed
  // to land somewhere; a payload and a stack trace are not.
  if (artifact.genre === "document" || artifact.genre === "presentation") {
    const tail = artifact.blocks.slice(-Math.max(3, Math.ceil(artifact.blocks.length * 0.15)));
    const totalWords = artifact.blocks.reduce((total, block) => total + wordCount(block.text), 0);
    if (totalWords > 120 && !tail.some((block) => hasCallToAction(block.text))) {
      findings.push({
        severity: "minor",
        category: "humanity.comprehension",
        title: "Ends without telling the reader what to do next",
        description:
          "The reader finishes, agrees, and does nothing — because nothing was asked of them. Comprehension without a next step is where most internal writing quietly fails.",
        evidence: tail.slice(-2).map((block) => truncate(block.text)),
        url,
        recommendation:
          "Close with the decision, the owner and the date, or the single next action.",
      });
    }
  }

  // Low comprehension is itself a finding, with the blocks that caused it.
  const worst = [...blocks]
    .filter((block) => (byId.get(block.blockId)?.text ?? "").trim().length > 0)
    .sort((a, b) => a.comprehension - b.comprehension)
    .slice(0, 3);
  const lost = blocks.filter((block) => block.comprehension < 0.5).length;
  if (lost > 0 && blocks.length > 0 && lost / blocks.length >= 0.2) {
    findings.push({
      severity: lost / blocks.length >= 0.4 ? "major" : "minor",
      category: "humanity.comprehension",
      title: `${persona.name} loses the thread in ${lost} of ${blocks.length} blocks`,
      description:
        "Comprehension is compounding: each block a reader does not follow makes the next one harder, because the terms it introduced were the ones the next block assumed.",
      evidence: worst.map(
        (block) =>
          `${Math.round(block.comprehension * 100)}% — ${truncate(byId.get(block.blockId)?.text ?? "")}` +
          (block.obstacles.length > 0 ? ` [${block.obstacles.map((o) => o.kind).join(", ")}]` : ""),
      ),
      url,
      recommendation:
        "Start with the blocks listed above: they are where this reader stopped following.",
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const CONCLUSION =
  /\b(?:in conclusion|to conclude|we recommend|recommendation|therefore|in summary|takeaway|bottom line|the fix|next steps?)\b/i;
const CALL_TO_ACTION =
  /\b(?:next steps?|action items?|we recommend|please|you (?:should|can|must|need to)|to get started|run |install |contact |sign up|apply|decide|approve|review by|owner:|due )\b/i;
const REMEDY =
  /\b(?:try|run|install|set|add|remove|check|see|use|pass|update|upgrade|retry|instead|hint|suggestion|did you mean|to fix|help)\b/i;
/** A title that names a topic rather than asserting anything about it. */
const LABEL_TITLE = /^(?:[\w&/-]+(?:\s+[\w&/-]+){0,3})$/;
const ASSERTIVE =
  /\b(?:is|are|was|were|will|has|have|grew|fell|rose|dropped|beats|needs|should|must|why|how|we|our)\b/i;

function isLabelTitle(title: string): boolean {
  const text = title.trim();
  if (!text || !LABEL_TITLE.test(text)) return false;
  return !ASSERTIVE.test(text);
}

function hasCallToAction(text: string): boolean {
  return CALL_TO_ACTION.test(text);
}

function suggestsRemedy(text: string): boolean {
  return REMEDY.test(text);
}

function findConclusionIndex(artifact: Artifact): number | null {
  for (let i = 0; i < artifact.blocks.length; i++) {
    if (CONCLUSION.test(artifact.blocks[i]?.text ?? "")) return i;
  }
  return null;
}

/** A header that names its unit: "(ms)", "revenue_usd", "latency ms", "% churn". */
function columnDeclaresUnit(column: string): boolean {
  return /\(|%|\$|£|€|¥|\b(?:ms|s|sec|secs|min|hrs?|usd|eur|gbp|pct|percent|bytes|kb|mb|gb|tb|count|per\b)\b|_(?:ms|s|usd|eur|gbp|pct|kb|mb|gb)$/i.test(
    column,
  );
}

/** A column is numeric when the rows that have a value are all numbers. */
function columnIsNumeric(table: TableDetail | undefined, index: number): boolean {
  if (!table || table.rows.length === 0) return false;
  const values = table.rows
    .map((row) => (row[index] ?? "").trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return false;
  return values.every((value) => /^[+-]?\d[\d,_]*(?:\.\d+)?$/.test(value));
}

function collectAcronyms(text: string): readonly string[] {
  return [...new Set(text.match(/\b[A-Z]{2,6}\b/g) ?? [])];
}

function sectionName(artifact: Artifact, block: ArtifactBlock): string {
  return artifact.sections[block.section]?.title ?? `section ${block.section + 1}`;
}

function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
