/**
 * Readability — how hard the prose is, measured the way reading research
 * measures it.
 *
 * EVE's rule is that every number traces to something that happened, and
 * that applies here too: these are counted properties of the text (sentence
 * lengths, syllables, terms introduced without definition), never an opinion
 * about the writing. A low Flesch score is not "bad writing" — it is a
 * measured claim that this reader, at this reading level, will have to work
 * for it, and the comprehension model is what turns that into an experience.
 */

const SENTENCE_SPLIT = /(?<=[.!?])[\s"')\]]+(?=[A-Z0-9])|\n{2,}/;
const WORD = /[A-Za-z][A-Za-z'-]*/g;

/** An acronym as a reader meets it: 2–6 capitals, optionally pluralized. */
const ACRONYM = /\b([A-Z]{2,6})(?:s)?\b/g;

/**
 * Acronyms so embedded in general computing literacy that a reader does not
 * experience them as jargon. Everything else has to be introduced somewhere
 * in the artifact before it counts as understood — which is exactly the rule
 * a good editor applies.
 */
const COMMON_ACRONYMS = new Set([
  "AI",
  "API",
  "APP",
  "CEO",
  "CFO",
  "CI",
  "CPU",
  "CSS",
  "CSV",
  "CTO",
  "DNS",
  "EU",
  "FAQ",
  "GB",
  "GDP",
  "GIF",
  "GPU",
  "HTML",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "IT",
  "JSON",
  "KB",
  "MB",
  "OK",
  "OS",
  "PDF",
  "PIN",
  "PM",
  "PNG",
  "QA",
  "RAM",
  "SDK",
  "SEO",
  "SQL",
  "SMS",
  "TB",
  "TV",
  "UI",
  "URL",
  "US",
  "USA",
  "USB",
  "UX",
  "VPN",
  "WIFI",
  "XML",
  "YAML",
  "ZIP",
]);

/**
 * Words that are jargon in the specific sense that matters: they carry a
 * meaning in software that a general reader will not recover from context,
 * and writers reach for them reflexively.
 */
const JARGON = new Set([
  "idempotent",
  "orthogonal",
  "canonical",
  "denormalized",
  "sharded",
  "eventual",
  "backpressure",
  "throughput",
  "latency",
  "serialization",
  "marshalling",
  "polymorphic",
  "instrumentation",
  "observability",
  "provisioning",
  "orchestration",
  "containerized",
  "middleware",
  "webhook",
  "payload",
  "endpoint",
  "schema",
  "namespace",
  "mutation",
  "hydration",
  "memoization",
  "coroutine",
  "mutex",
  "quorum",
  "consensus",
  "replication",
  "isomorphic",
  "declarative",
  "imperative",
  "monorepo",
  "refactor",
  "regression",
  "leverage",
  "synergy",
  "utilize",
  "operationalize",
  "actionable",
  "holistic",
  "paradigm",
  "bandwidth",
  "ideate",
  "granular",
  "scalable",
  "robust",
  "seamless",
]);

export interface ReadabilityMetrics {
  readonly words: number;
  readonly sentences: number;
  readonly syllables: number;
  readonly meanSentenceWords: number;
  /** Flesch Reading Ease, 0..100+. Higher is easier; 60 is plain English. */
  readonly fleschReadingEase: number;
  /** Flesch–Kincaid grade level — years of schooling assumed by the prose. */
  readonly gradeLevel: number;
  /** Words of three or more syllables, as a share of all words. */
  readonly complexWordRatio: number;
  readonly longestSentenceWords: number;
}

/** Measure a passage. Empty text is perfectly readable and says nothing. */
export function measureReadability(text: string): ReadabilityMetrics {
  const sentences = splitSentences(text);
  const words = text.match(WORD) ?? [];
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const complex = words.filter((word) => countSyllables(word) >= 3).length;

  if (words.length === 0 || sentences.length === 0) {
    return {
      words: 0,
      sentences: 0,
      syllables: 0,
      meanSentenceWords: 0,
      fleschReadingEase: 100,
      gradeLevel: 0,
      complexWordRatio: 0,
      longestSentenceWords: 0,
    };
  }

  const wordsPerSentence = words.length / sentences.length;
  const syllablesPerWord = syllables / words.length;
  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const grade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;

  return {
    words: words.length,
    sentences: sentences.length,
    syllables,
    meanSentenceWords: round(wordsPerSentence),
    fleschReadingEase: round(clamp(flesch, 0, 120)),
    gradeLevel: round(Math.max(0, grade)),
    complexWordRatio: round(complex / words.length),
    longestSentenceWords: Math.max(
      ...sentences.map((sentence) => (sentence.match(WORD) ?? []).length),
    ),
  };
}

export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((sentence) => sentence.trim())
    .filter((sentence) => (sentence.match(WORD) ?? []).length > 0);
}

/**
 * Syllable estimate: vowel groups, minus a silent trailing "e", never below
 * one. The standard heuristic behind every Flesch implementation — accurate
 * enough in aggregate, which is the only scale the score is read at.
 */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length === 0) return 0;
  if (clean.length <= 3) return 1;
  const trimmed = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Acronyms used in the text, split by whether the text ever expands them. */
export interface AcronymUse {
  readonly acronym: string;
  /** True when the artifact defines it: "Service Level Objective (SLO)". */
  readonly introduced: boolean;
  readonly firstSeenIn: string;
}

/**
 * Find acronyms and decide whether the artifact ever introduced them.
 *
 * Two forms count as an introduction, because both are how writing actually
 * does it: the expansion followed by the acronym in parentheses, and the
 * acronym followed by its expansion. Anything else is a term the reader is
 * assumed to already know — which is a claim about the audience the artifact
 * never checked.
 */
export function findAcronyms(passages: readonly string[]): readonly AcronymUse[] {
  const whole = passages.join("\n");
  const seen = new Map<string, string>();

  for (const passage of passages) {
    ACRONYM.lastIndex = 0;
    let match = ACRONYM.exec(passage);
    while (match !== null) {
      const acronym = match[1] ?? "";
      if (!COMMON_ACRONYMS.has(acronym) && !seen.has(acronym)) {
        seen.set(acronym, passage);
      }
      match = ACRONYM.exec(passage);
    }
  }

  return [...seen.entries()].map(([acronym, firstSeenIn]) => ({
    acronym,
    introduced: isIntroduced(acronym, whole),
    firstSeenIn,
  }));
}

function isIntroduced(acronym: string, text: string): boolean {
  const letters = [...acronym];
  // "Service Level Objective (SLO)" — initials of the preceding words.
  const expansionThenAcronym = new RegExp(
    `(?:\\b[A-Za-z][\\w-]*\\s+){${letters.length - 1},${letters.length + 2}}\\(${acronym}s?\\)`,
  );
  if (expansionThenAcronym.test(text)) return true;
  // "SLO (Service Level Objective)" — the same pair, the other way round.
  const acronymThenExpansion = new RegExp(`\\b${acronym}s?\\s*\\((?:[^)]{4,80})\\)`);
  if (acronymThenExpansion.test(text)) return true;
  // "SLO stands for / means / is short for …"
  return new RegExp(`\\b${acronym}s?\\s+(?:stands for|means|is short for|=)`, "i").test(text);
}

/** Jargon terms present in the text, deduplicated and lowercased. */
export function findJargon(text: string): readonly string[] {
  const words = (text.toLowerCase().match(WORD) ?? []).map((word) => word.replace(/'s$/, ""));
  const found = new Set<string>();
  for (const word of words) {
    if (JARGON.has(word)) found.add(word);
    // Common inflections of the same terms ("sharding", "refactored").
    else {
      const stem = word.replace(/(?:ing|ed|s|es|ion|ions|ity|ies)$/, "");
      if (stem.length >= 5 && JARGON.has(stem)) found.add(stem);
    }
  }
  return [...found];
}

/** The jargon vocabulary, exposed so domain packs can reason about it. */
export function jargonVocabulary(): readonly string[] {
  return [...JARGON];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
