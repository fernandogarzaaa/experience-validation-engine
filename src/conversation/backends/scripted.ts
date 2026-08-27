/**
 * The scripted backend — a conversational surface written down.
 *
 * Two jobs. It is how the test suite gets a deterministic interlocutor, and
 * it is how `eve chat mock:` demonstrates the seam with no network and no
 * API key, the same way `eve run mock:` demonstrates the browser one.
 *
 * A script is a list of rules matched against what the operator says. That
 * is not a toy: it is exactly what a scripted-flow bot *is*, so this backend
 * models one class of real surface honestly rather than only standing in for
 * the others. The `fallback` is the surface's fallback intent — the reply a
 * real bot gives when nothing matched — and modelling it as a first-class
 * field is what lets EVE experience the thing that actually goes wrong.
 */

import type { ConversationBackend, ConversationKind, ConversationReply } from "../types.js";

export interface ScriptRule {
  /** Matched against the operator's message, case-insensitively. */
  readonly when: RegExp | string;
  readonly reply: string;
  /** Simulated thinking time, in ms — what the operator waits through. */
  readonly latencyMs?: number;
  readonly refused?: boolean;
  readonly ended?: boolean;
  readonly affordances?: ConversationReply["affordances"];
  /** Fire this rule at most once; afterwards fall through to the next match. */
  readonly once?: boolean;
}

export interface Script {
  readonly name: string;
  readonly kind?: ConversationKind;
  /** What the surface says before the operator says anything. */
  readonly greeting?: string;
  readonly rules: readonly ScriptRule[];
  /** What the surface says when nothing matches — its fallback intent. */
  readonly fallback: string;
  /** ms of thinking time when a rule does not specify its own. */
  readonly latencyMs?: number;
}

export class ScriptedBackend implements ConversationBackend {
  readonly name: string;
  readonly kind: ConversationKind;

  private readonly used = new Set<number>();

  constructor(private readonly script: Script) {
    this.name = script.name;
    this.kind = script.kind ?? "scripted";
  }

  async open(): Promise<ConversationReply | null> {
    this.used.clear();
    if (!this.script.greeting) return null;
    return { text: this.script.greeting, latencyMs: 0 };
  }

  async send(message: string): Promise<ConversationReply> {
    const index = this.script.rules.findIndex((rule, i) => {
      if (rule.once && this.used.has(i)) return false;
      return matches(rule.when, message);
    });

    if (index === -1) {
      // Nothing matched. This is the moment that decides most conversational
      // experiences, so it is a real reply with a real cost, not an error.
      return {
        text: this.script.fallback,
        notUnderstood: true,
        latencyMs: this.script.latencyMs ?? 400,
      };
    }

    const rule = this.script.rules[index] as ScriptRule;
    if (rule.once) this.used.add(index);
    return {
      text: rule.reply,
      latencyMs: rule.latencyMs ?? this.script.latencyMs ?? 400,
      ...(rule.refused ? { refused: true } : {}),
      ...(rule.ended ? { ended: true } : {}),
      ...(rule.affordances ? { affordances: rule.affordances } : {}),
    };
  }
}

function matches(when: RegExp | string, message: string): boolean {
  if (typeof when === "string") return message.toLowerCase().includes(when.toLowerCase());
  return when.test(message);
}

/**
 * The built-in demo bot, reachable as `eve chat mock:`.
 *
 * Deliberately a *plausible* support bot rather than a bad one: it greets
 * well, handles its happy path, and is confidently unhelpful everywhere
 * else. It never says it did not understand — it answers a nearby question
 * instead, which is the failure real users describe as "it kept talking past
 * me". Running EVE against it should produce findings that look familiar to
 * anyone who has used one of these.
 */
export const DEMO_SUPPORT_BOT: Script = {
  name: "demo-support-bot",
  kind: "support",
  greeting: "Hi! I'm Ava, your virtual assistant. How can I help you today?",
  latencyMs: 900,
  rules: [
    {
      when: /\b(?:hello|hi|hey)\b/i,
      reply: "Hello! What can I do for you?",
      latencyMs: 300,
    },
    {
      when: /\btrack(?:ing)?\b.*\border\b|\border\b.*\bstatus\b|\bwhere is my order\b/i,
      reply:
        "You can track your order from the Orders page in your account. Just sign in and select the order you'd like to track.",
      affordances: [{ id: "s1", kind: "suggestion", label: "Go to Orders" }],
    },
    {
      when: /\brefund\b|\bmoney back\b|\breturn\b/i,
      reply:
        "I can help with returns! Most items can be returned within 30 days. Would you like me to start a return?",
      affordances: [{ id: "s2", kind: "suggestion", label: "Start a return" }],
    },
    {
      // The known trap: the operator has been charged twice, and the bot
      // hears "charge" and routes them to the billing FAQ. Confidently.
      when: /\bcharged\b|\bbilling\b|\bpayment\b|\binvoice\b|\bcharge\b/i,
      reply:
        "Our billing cycle runs monthly, and invoices are issued on the first of each month. You can view all invoices under Billing in your account settings.",
    },
    {
      when: /\bcancel\b.*\bsubscription\b|\bunsubscribe\b/i,
      reply:
        "I'm sorry to hear that! Before you go — did you know you can pause your subscription instead? Pausing keeps your history and settings.",
    },
    {
      when: /\b(?:human|person|agent|representative|someone real)\b/i,
      reply: "I can help with most questions! Could you tell me a bit more about what you need?",
    },
  ],
  // The fallback answers a nearby question rather than admitting the miss —
  // which is why EVE's operator keeps trying instead of escalating.
  fallback:
    "I want to make sure I get this right. You can find answers to most questions in our Help Centre, which covers orders, returns, billing and account settings.",
};
