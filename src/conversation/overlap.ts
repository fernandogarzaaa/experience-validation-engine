/**
 * Did the reply engage with the question?
 *
 * The one comparison this seam keeps making: a person asks something, gets a
 * fluent paragraph back, and has to work out whether it was an answer or an
 * answer to something else. Both the adapter (live, to decide whether the
 * operator perceives a miss) and the analysis (afterwards, to report it) need
 * exactly the same judgment, so it lives here once rather than in each.
 *
 * Stemming is not a nicety here — it is the difference between working and
 * being actively harmful. "I want a refund because I was charged twice"
 * answered with "I've refunded the duplicate charge" shares no *literal*
 * word with the question: refund/refunded and charged/charge are different
 * strings. Comparing raw tokens marks a perfect reply as a near-miss, which
 * is the worst error this tool can make — telling someone their good bot is
 * a bad one.
 */

const STOPWORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "can",
  "could",
  "will",
  "would",
  "should",
  "may",
  "might",
  "must",
  "i",
  "you",
  "we",
  "they",
  "it",
  "he",
  "she",
  "me",
  "my",
  "your",
  "our",
  "their",
  "its",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "by",
  "about",
  "as",
  "into",
  "like",
  "so",
  "just",
  "get",
  "got",
  "please",
  "thanks",
  "thank",
  "hello",
  "hi",
  "hey",
  "sorry",
  "want",
  "need",
  "help",
  "there",
  "here",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "why",
  "not",
  "any",
  "all",
  "some",
  "one",
  "out",
  "up",
  "now",
]);

/** Suffixes stripped to reach a stem, longest first so "ations" beats "s". */
const SUFFIXES = [
  "ations",
  "ation",
  "ings",
  "ing",
  "edly",
  "ed",
  "ies",
  "ily",
  "ly",
  "es",
  "ment",
  "ness",
  "s",
  // The bare "e" matters more than it looks: without it "charges" strips to
  // "charg" while the base "charge" keeps its vowel, so the two never unify
  // and a reply saying "charge" scores as ignoring a question that said
  // "charged". Dropping the silent "e" from both sides makes the whole
  // family — charge/charged/charges/charging — one word.
  "e",
];

/** Minimum stem length — below this, stripping destroys the word. */
const MIN_STEM = 4;

/**
 * Reduce a word to a stem a reader would treat as the same concept.
 *
 * Deliberately a suffix-stripper rather than a real morphological stemmer:
 * the comparison downstream is a ratio over a handful of words, so precision
 * matters far less than catching the everyday inflections people actually
 * use — refund/refunded, charge/charged/charges, cancel/cancelling.
 */
export function stem(word: string): string {
  let stemmed = word;
  for (const suffix of SUFFIXES) {
    if (stemmed.length - suffix.length >= MIN_STEM && stemmed.endsWith(suffix)) {
      stemmed = stemmed.slice(0, -suffix.length);
      break;
    }
  }
  // "cancelling" → "cancell" → "cancel"; doubled consonants survive stripping.
  if (stemmed.length > MIN_STEM && /([bdfglmnprt])\1$/.test(stemmed)) {
    stemmed = stemmed.slice(0, -1);
  }
  return stemmed;
}

/** The words that carry a sentence's meaning, stemmed and deduplicated. */
export function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  const content = new Set<string>();
  for (const word of words) {
    const bare = word.replace(/'s$/, "");
    if (STOPWORDS.has(bare)) continue;
    content.add(stem(bare));
  }
  return content;
}

/** Share of the question's meaningful words the reply picks up, 0..1. */
export function overlapRatio(question: string, reply: string): number {
  const asked = contentWords(question);
  if (asked.size === 0) return 1;
  const answered = contentWords(reply);
  let shared = 0;
  for (const word of asked) if (answered.has(word)) shared += 1;
  return shared / asked.size;
}

/** Below this, the reply is about something else. */
const NEAR_MISS_RATIO = 0.25;
/**
 * Below this many words, a reply is too short to judge — "Sure!", "Done.",
 * "Yes, of course." are not attempts at an answer, so they cannot be wrong
 * ones. Counted in *words as written*, not in distinct content stems: a
 * perfectly normal paragraph can reduce to five or six stems, and judging
 * that as "too short" silently exempts exactly the fluent, confident
 * near-misses this exists to catch.
 */
const MIN_JUDGEABLE_REPLY_WORDS = 12;
/** Fewer stems than this and the ratio is noise rather than signal. */
const MIN_JUDGEABLE_REPLY_STEMS = 3;

/**
 * True when the surface answered a different question without saying so.
 *
 * Conservative on purpose, in both directions that matter: a reply too short
 * to be an answer is never judged, and a question with almost no content
 * words is never judged either — there is nothing there to miss.
 */
export function isNearMiss(question: string, reply: string): boolean {
  const asked = contentWords(question);
  if (asked.size < 2) return false;
  if (reply.split(/\s+/).filter(Boolean).length < MIN_JUDGEABLE_REPLY_WORDS) return false;
  if (contentWords(reply).size < MIN_JUDGEABLE_REPLY_STEMS) return false;
  return overlapRatio(question, reply) < NEAR_MISS_RATIO;
}
