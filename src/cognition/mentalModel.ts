import type {
  Percept,
  Prediction,
  PredictionOutcome,
  VisibleElement,
} from "../core/types.js";
import { clamp01 } from "../core/random.js";
import { screenSignature } from "../memory/memory.js";

/**
 * The operator's evolving mental model of the application, and the machinery
 * for predicting outcomes and confronting predictions with reality.
 */

const ERROR_PATTERNS: readonly RegExp[] = [
  /\berror\b/i,
  /\bfailed?\b/i,
  /\binvalid\b/i,
  /\bincorrect\b/i,
  /\brequired\b/i,
  /\bnot\s+found\b/i,
  /\b(4|5)\d\d\b/,
  /\bwrong\b/i,
  /\bunable to\b/i,
  /\bsomething went wrong\b/i,
  /\btry again\b/i,
  /\bdenied\b/i,
  /\bforbidden\b/i,
  /\bunexpected\b/i,
  /\boops\b/i,
];

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "in", "on", "for", "with", "your",
  "you", "is", "are", "this", "that", "it", "at", "by", "be", "as", "from",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** All human-readable text on the screen, flattened. */
export function visibleText(percept: Percept): string {
  const parts = [percept.title];
  for (const el of percept.elements) if (el.text) parts.push(el.text);
  for (const d of percept.dialogs) parts.push(d.text);
  return parts.join(" \n ");
}

/** Is a visible error message perceivable on this screen? */
export function perceivesError(percept: Percept): boolean {
  const text = visibleText(percept);
  return ERROR_PATTERNS.some((re) => re.test(text));
}

/** Error text snippets, for evidence in findings. */
export function errorSnippets(percept: Percept): string[] {
  const snippets: string[] = [];
  for (const el of percept.elements) {
    if (el.text && ERROR_PATTERNS.some((re) => re.test(el.text))) {
      snippets.push(el.text.trim().slice(0, 140));
    }
  }
  for (const d of percept.dialogs) {
    if (ERROR_PATTERNS.some((re) => re.test(d.text))) snippets.push(d.text.trim().slice(0, 140));
  }
  return [...new Set(snippets)].slice(0, 5);
}

/**
 * Build a prediction for interacting with an element, from nothing but its
 * visible label and the operator's conventions knowledge (techLiteracy is
 * applied by the caller as a confidence modifier).
 */
export function predictInteraction(
  element: VisibleElement,
  verb: "click" | "type",
  baseConfidence: number,
): Prediction {
  const labelTokens = tokenize(element.text).slice(0, 4);
  if (verb === "type") {
    return {
      description: `Typing here should fill the "${element.text.trim() || "text"}" field.`,
      expectedSignals: [],
      expectsChange: false,
      confidence: clamp01(baseConfidence + 0.2),
    };
  }
  const destructive = /\b(delete|remove|discard|reset|clear)\b/i.test(element.text);
  const navigational =
    element.role === "link" || element.role === "tab" || element.role === "menuitem";
  const description = destructive
    ? `Clicking "${element.text.trim()}" will probably ask me to confirm before destroying anything.`
    : navigational
      ? `Clicking "${element.text.trim()}" should take me to a screen about ${labelTokens.join(" ") || "that topic"}.`
      : `Clicking "${element.text.trim()}" should do what the label says and show me the result.`;
  return {
    description,
    expectedSignals: destructive ? [...labelTokens, "confirm", "sure"] : labelTokens,
    expectsChange: true,
    confidence: clamp01(baseConfidence * (element.text.trim() ? 1 : 0.6)),
  };
}

/**
 * Compare a prediction against the screen that actually followed the action.
 * This is where "was my expectation correct?" gets a number.
 */
export function comparePrediction(
  prediction: Prediction,
  before: Percept,
  after: Percept,
  perceivedLatencyMs: number,
): PredictionOutcome {
  const screenChanged =
    screenSignature(before) !== screenSignature(after) ||
    significantTextChange(before, after);
  const afterText = visibleText(after).toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const signal of prediction.expectedSignals) {
    if (afterText.includes(signal.toLowerCase())) matched.push(signal);
    else missed.push(signal);
  }
  const errorPerceived = perceivesError(after) && !perceivesError(before);

  let surprise = 0;
  if (prediction.expectsChange && !screenChanged) {
    surprise = 0.85; // "I clicked and nothing happened"
  } else if (!prediction.expectsChange && screenChanged) {
    surprise = 0.7; // "I didn't expect the whole screen to change"
  } else if (prediction.expectedSignals.length > 0) {
    const hitRate = matched.length / prediction.expectedSignals.length;
    surprise = clamp01(0.65 * (1 - hitRate));
  }
  if (errorPerceived) surprise = clamp01(surprise + 0.35);

  return {
    prediction,
    surprise,
    matchedSignals: matched,
    missedSignals: missed,
    screenChanged,
    errorPerceived,
    perceivedLatencyMs,
  };
}

/** Rough text-level change detector (Jaccard distance over token sets). */
function significantTextChange(before: Percept, after: Percept): boolean {
  const a = new Set(tokenize(visibleText(before)));
  const b = new Set(tokenize(visibleText(after)));
  if (a.size === 0 && b.size === 0) return false;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  const similarity = union === 0 ? 1 : intersection / union;
  return similarity < 0.75;
}

/**
 * The operator's running one-sentence theory of what the application is.
 * Rebuilt whenever a more informative screen appears.
 */
export function inferAppTheory(percept: Percept): string {
  const headings = percept.elements
    .filter((e) => e.role === "heading" && e.text.trim())
    .map((e) => e.text.trim())
    .slice(0, 2);
  const title = percept.title.trim();
  if (headings.length > 0) {
    return `This looks like an app about "${headings.join(" / ")}"${title ? ` (titled "${title}")` : ""}.`;
  }
  if (title) return `This seems to be "${title}".`;
  return "I can't tell what this application is yet.";
}
