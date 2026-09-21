import { clamp01 } from "../core/random.js";
import type { Modality } from "../core/registry.js";
import type { Percept, Prediction, PredictionOutcome, VisibleElement } from "../core/types.js";
import { sensitiveStateKey } from "../memory/surfaceIdentity.js";

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
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "for",
  "with",
  "your",
  "you",
  "is",
  "are",
  "this",
  "that",
  "it",
  "at",
  "by",
  "be",
  "as",
  "from",
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

/**
 * Visible text excluding the labels of interactive controls.
 *
 * The difference between this and {@link visibleText} is the difference
 * between "the screen says the export finished" and "the screen has a button
 * that says Export". Used to tell whether a goal success signal is carried
 * only by an affordance the operator may never have activated.
 */
export function passiveText(percept: Percept): string {
  const parts = [percept.title];
  for (const el of percept.elements) if (el.text && !el.interactive) parts.push(el.text);
  for (const d of percept.dialogs) parts.push(d.text);
  return parts.join(" \n ");
}

/**
 * Layered error evidence (P1.4). Plain lexical matching confuses "Error
 * rate: 1.2%", "Required reading" or "Failed experiments" (content ABOUT
 * failure) with an application failure the operator faces. Strength order:
 *
 * 1. semantic role (alert/dialog) — strong, "observed";
 * 2. native dialog carrying error text — strong, "observed";
 * 3. form-validation context (disabled/invalid-adjacent interactive element
 *    with error text) — moderate, "derived";
 * 4. bare lexical match — weak fallback, "heuristic", filtered against
 *    known false-positive prose contexts.
 *
 * Lexical detection is kept (backwards compat) but graded weak.
 */
export type ErrorEvidenceLevel = "strong" | "moderate" | "weak" | "none";

export interface ErrorEvidence {
  readonly level: ErrorEvidenceLevel;
  readonly provenance: "observed" | "derived" | "heuristic";
  readonly snippets: readonly string[];
}

/** Prose contexts where error words describe content, not a failure. */
const FALSE_POSITIVE_CONTEXTS: readonly RegExp[] = [
  /\berror\s+rates?\b/i,
  /\brequired\s+reading\b/i,
  /\bfailed\s+(experiments?|tests?\s+as\s+content)\b/i,
  /\bwrong\s+answers?\s+explained\b/i,
  /\b404\s+(reference|explanation|guide|doc(umentation)?|page\s+not\s+found\s+guide)\b/i,
  /\b(error|failure|fail|invalid)\b[^.]{0,40}\b(rate|percentage|%|statistics|report|analysis|study|experiment)\b/i,
  /\b(rate|percentage)\s*:\s*\d/i,
];

function inFalsePositiveContext(text: string): boolean {
  return FALSE_POSITIVE_CONTEXTS.some((re) => re.test(text));
}

function lexicalHit(text: string): boolean {
  return ERROR_PATTERNS.some((re) => re.test(text));
}

export function classifyErrorEvidence(
  percept: Percept,
  modality: Modality = "visual",
): ErrorEvidence {
  if (modality === "document") return { level: "none", provenance: "heuristic", snippets: [] };
  const snippets: string[] = [];
  // 1–2. Semantic role + native dialogs: strong.
  for (const el of percept.elements) {
    if ((el.role === "alert" || el.role === "dialog") && el.text.trim()) {
      if (lexicalHit(el.text) || el.role === "alert") {
        snippets.push(el.text.trim().slice(0, 140));
      }
    }
  }
  for (const d of percept.dialogs) {
    if (lexicalHit(d.text)) snippets.push(d.text.trim().slice(0, 140));
  }
  if (snippets.length > 0) {
    return {
      level: "strong",
      provenance: "observed",
      snippets: [...new Set(snippets)].slice(0, 5),
    };
  }
  // 3. Form-validation context: error text on/near an interactive control.
  const moderate: string[] = [];
  for (const el of percept.elements) {
    if (!el.text || !lexicalHit(el.text)) continue;
    if (inFalsePositiveContext(el.text)) continue;
    if (el.interactive || el.editable || el.disabled) moderate.push(el.text.trim().slice(0, 140));
  }
  if (moderate.length > 0) {
    return {
      level: "moderate",
      provenance: "derived",
      snippets: [...new Set(moderate)].slice(0, 5),
    };
  }
  // 4. Weak lexical fallback, filtered.
  const weak: string[] = [];
  for (const el of percept.elements) {
    if (!el.text || !lexicalHit(el.text)) continue;
    if (inFalsePositiveContext(el.text)) continue;
    weak.push(el.text.trim().slice(0, 140));
  }
  if (weak.length > 0) {
    return { level: "weak", provenance: "heuristic", snippets: [...new Set(weak)].slice(0, 5) };
  }
  return { level: "none", provenance: "heuristic", snippets: [] };
}
/**
 * Is a visible error message perceivable on this screen?
 *
 * Layered evidence (P1.4) via {@link classifyErrorEvidence}: semantic
 * role/dialog matches count as strong observed evidence; bare lexical
 * matches are weak heuristic evidence filtered against false-positive
 * prose ("Error rate", "Required reading", ...).
 *
 * Document-modality gating is unchanged (see history): prose *about*
 * failures on a page of text is not a failure the reader faces.
 */
export function perceivesError(percept: Percept, modality: Modality = "visual"): boolean {
  if (modality === "document") return false;
  return classifyErrorEvidence(percept, modality).level !== "none";
}

/** Error text snippets, for evidence in findings. See {@link perceivesError}. */
export function errorSnippets(percept: Percept, modality: Modality = "visual"): string[] {
  if (modality === "document") return [];
  return [...classifyErrorEvidence(percept, modality).snippets];
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
  modality: Modality = "visual",
): PredictionOutcome {
  // Outcome interpretation uses the SENSITIVE state: a validation error or
  // dialog appearing IS a changed state even when the stable layout matches.
  const screenChanged =
    sensitiveStateKey(before) !== sensitiveStateKey(after) || significantTextChange(before, after);
  const afterText = visibleText(after).toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const signal of prediction.expectedSignals) {
    if (afterText.includes(signal.toLowerCase())) matched.push(signal);
    else missed.push(signal);
  }
  const errorPerceived = perceivesError(after, modality) && !perceivesError(before, modality);

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
