/**
 * The conversational model — what a surface that answers back looks like.
 *
 * EVE's adapters have covered surfaces the operator *drives* and, since the
 * humanity seam, output they *read*. This is the third relationship: a
 * surface that **replies**. A support bot. An LLM copilot. A voice
 * assistant. The "ask me anything" box that has quietly become the front
 * door of a lot of products.
 *
 * It is not a document delivered in pieces, and modelling it as one loses
 * everything that matters. A dialogue has no back button, so a
 * misunderstanding cannot be undone — only talked past. The operator waits
 * without knowing whether anything is happening. And it is the only surface
 * that can fail to understand *them*, which puts a decision in front of the
 * operator no other modality does: rephrase, or give up?
 *
 * The perception boundary holds exactly as elsewhere. The operator perceives
 * what the surface says and what it offers alongside — suggested replies, a
 * handoff to a human, a citation. Not its prompt, not its confidence
 * scores, not its intent classification. A user of a support bot cannot see
 * those either.
 */

import type { ConversationTurn, Speaker } from "../core/kernel.js";

export type { ConversationTurn, Speaker };

/**
 * What kind of thing the operator is talking to. Like `ArtifactGenre` in the
 * humanity seam, this is the load-bearing field: it sets what the operator
 * expects, and therefore what counts as a failure.
 */
export type ConversationKind =
  /** A support bot with a task to complete: refund, reset, book, cancel. */
  | "support"
  /** An open-ended assistant: explain, draft, summarize, decide. */
  | "assistant"
  /** An in-product copilot that acts on the product on the operator's behalf. */
  | "copilot"
  /** A scripted flow — menus, buttons, decision trees, IVR. */
  | "scripted";

/** One thing the operator can act on beside typing: a chip, a handoff, a card. */
export interface ConversationAffordance {
  readonly id: string;
  /** `suggestion` (a canned reply), `handoff` (reach a human), `action`. */
  readonly kind: "suggestion" | "handoff" | "action";
  readonly label: string;
}

/** What the surface said back, and what it said it with. */
export interface ConversationReply {
  readonly text: string;
  /**
   * The surface signalled it did not understand — a fallback intent, "sorry,
   * I didn't catch that", "could you rephrase". Backends set this when the
   * surface says so explicitly; {@link detectNonAnswer} infers it otherwise.
   */
  readonly notUnderstood?: boolean;
  /** The surface declined: out of scope, not permitted, "I can't help with that". */
  readonly refused?: boolean;
  /** Things offered beside the text. */
  readonly affordances?: readonly ConversationAffordance[];
  /** How long the operator waited, in ms. Backends that know should say. */
  readonly latencyMs?: number;
  /** The surface ended the conversation (session closed, handed off, timed out). */
  readonly ended?: boolean;
}

/**
 * A conversational surface EVE can talk to.
 *
 * Deliberately one method. Everything a dialogue *is* — turn history, repair
 * counting, what the operator still recalls — belongs to the adapter and the
 * kernel, not to the transport. A backend's whole job is: given what the
 * operator said, what comes back and how long did it take.
 */
export interface ConversationBackend {
  readonly name: string;
  /** What the operator is talking to, when the backend knows. */
  readonly kind?: ConversationKind;
  /** Open the conversation. Returns a greeting, when the surface opens with one. */
  open?(): Promise<ConversationReply | null>;
  /** Say something; get what comes back. */
  send(message: string): Promise<ConversationReply>;
  close?(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Recognizing a non-answer                                            */
/* ------------------------------------------------------------------ */

/**
 * Phrases a surface uses to admit it did not understand. A person reads
 * these as one thing — "it didn't get me" — regardless of which one fired.
 */
const NOT_UNDERSTOOD = [
  /\b(?:i'?m )?(?:sorry|afraid)[^.!?]{0,40}\b(?:didn'?t|did not|don'?t|do not)\s+(?:quite\s+)?(?:understand|catch|get|follow)\b/i,
  /\bi (?:didn'?t|did not|don'?t|do not)\s+(?:quite\s+)?(?:understand|catch|get|follow)\b/i,
  /\b(?:could|can|would) you (?:please )?(?:rephrase|try again|say that again|clarify)\b/i,
  /\bnot sure (?:what|that) (?:you|i)\b/i,
  /\bi'?m not sure i (?:understand|follow)\b/i,
  /\blet'?s try (?:that|this) again\b/i,
  /\bplease (?:rephrase|try) /i,
];

/** Phrases a surface uses to decline. Distinct from failing to understand. */
const REFUSED = [
  /\bi (?:can'?t|cannot|am unable to|won'?t)\s+(?:help|assist|do|answer|provide)\b/i,
  /\b(?:that'?s|this is) (?:outside|beyond|not within)\b/i,
  /\bi (?:don'?t|do not) have (?:access|the ability|permission)\b/i,
  /\bnot something i can\b/i,
  /\bi'?m (?:only|just) able to\b/i,
];

/**
 * Read a reply the way the operator does: did it not understand me, or is it
 * declining? These are different experiences — a person rephrases for the
 * first and looks for another route for the second — so the model keeps them
 * apart rather than collapsing both into "the bot failed".
 */
export function detectNonAnswer(text: string): {
  notUnderstood: boolean;
  refused: boolean;
} {
  return {
    notUnderstood: NOT_UNDERSTOOD.some((pattern) => pattern.test(text)),
    refused: REFUSED.some((pattern) => pattern.test(text)),
  };
}

/**
 * Phrases that offer a way to reach a person.
 *
 * The optional article carries its own trailing space rather than sitting
 * between `\s+` and `\s*`. Phrased the natural way — `\s+(?:a|an|our)?\s*` —
 * a run of whitespace belongs to both matchers, so every way of splitting it
 * is a candidate the engine has to try, and a reply that ends up not being a
 * handoff costs quadratic time. Replies come from whatever endpoint the
 * caller pointed EVE at, so a pathological one is ordinary input.
 */
const HANDOFF =
  /\b(?:speak|talk|connect(?:ing)?|transfer(?:ring)?|escalat\w*)\s+(?:you\s+)?(?:to|with)\s+(?:(?:an?|our)\s+)?(?:human|agent|representative|person|advisor|support team)\b|\bhuman agent\b|\blive (?:agent|chat|support)\b/i;

/** True when the reply offers a route to a person. */
export function offersHandoff(reply: ConversationReply): boolean {
  if (reply.affordances?.some((a) => a.kind === "handoff")) return true;
  return HANDOFF.test(reply.text);
}

/** Words in a turn, counted the way a listener consumes them. */
export function turnWordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
