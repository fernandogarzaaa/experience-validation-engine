/**
 * ConversationAdapter — EVE has a conversation.
 *
 * The browser adapters put the operator in front of software they drive; the
 * humanity adapter put a reader in front of output they receive. This one
 * puts a person in front of something that **answers back**, which is a
 * different relationship again and fails in its own way.
 *
 * **Kernel-native.** The source of truth is the conversational kernel
 * (`src/core/kernel.ts`): turn order as geometry, a `not-understood` signal
 * for the one failure only a dialogue has, and a repair count — because how
 * many times a person has already rephrased is the single best predictor of
 * whether they are about to leave. The legacy browser-flavored snapshot is
 * derived from the same state, so scoring, workflows, reports and the
 * session loop all work on a conversation unchanged.
 *
 * | Kernel concept    | Conversation                       | Deprecated web view    |
 * | ----------------- | ---------------------------------- | ---------------------- |
 * | frame identity    | the surface's address + name       | `url` / `title`        |
 * | affordances       | suggested replies, handoff         | buttons and links      |
 * | turn order        | `turns[]`, oldest first            | transcript lines       |
 * | it misunderstood  | `not-understood` signal            | a fake modal "dialog"  |
 * | it is composing   | `awaitingReply`                    | a loading indicator    |
 * | latency           | `lastLatencyMs`, measured          | (lost)                 |
 *
 * The perception boundary is unchanged: the operator perceives what the
 * surface says and what it offers alongside. Not its prompt, not its
 * confidence, not its intent classifier — a user of a support bot sees none
 * of those either.
 */

import type { BrowserAdapter, KernelSurface, RawSnapshot } from "../browser/adapter.js";
import type {
  Affordance,
  ConversationalKernelPercept,
  KernelAction,
  SurfaceSignal,
} from "../core/kernel.js";
import type { Point, Viewport } from "../core/types.js";
import { getPersona } from "../personas/library.js";
import type { Persona } from "../personas/persona.js";
import { workingMemoryCapacity } from "../personas/persona.js";
import { CONVERSATION_VERBS, CONVERSATIONAL_SURFACE } from "../surface/capabilities.js";
import { webPerceptFromKernel } from "../surface/kernelView.js";
import { isNearMiss } from "./overlap.js";
import type {
  ClassifiedTurn,
  ConversationBackend,
  ConversationKind,
  ConversationReply,
} from "./types.js";
import { detectNonAnswer, offersHandoff } from "./types.js";

export interface ConversationAdapterOptions {
  readonly backend: ConversationBackend;
  /**
   * The person doing the talking. How many times they will rephrase before
   * giving up is a property of them, not of the bot, so the adapter needs it
   * to report what this operator actually experienced.
   */
  readonly persona?: Persona;
  /** What the operator is talking to; overrides the backend's own answer. */
  readonly kind?: ConversationKind;
  /** Operator-visible address, e.g. `chat:https://…` or `chat:mock:`. */
  readonly address?: string;
}

export class ConversationAdapter implements BrowserAdapter, KernelSurface {
  readonly name = "conversation";
  readonly capabilities = { ...CONVERSATIONAL_SURFACE, actionVerbs: CONVERSATION_VERBS };

  private readonly backend: ConversationBackend;
  private persona: Persona;
  private address: string;

  private turns: ClassifiedTurn[] = [];
  private openedAt = Date.now();
  private awaitingReply = false;
  private lastLatencyMs: number | null = null;
  private repairAttempts = 0;
  private ended = false;
  /** What the operator said last, so a rephrase can be recognized as one. */
  private lastOperatorMessage: string | null = null;
  private opened = false;

  constructor(private readonly options: ConversationAdapterOptions) {
    this.backend = options.backend;
    // Talking to a bot is persona-relative: patience decides how many
    // rephrases happen before someone leaves. Default to the ordinary
    // person, not an expert prompter.
    this.persona = options.persona ?? getPersona("first-time-user");
    this.address = options.address ?? `chat:${options.backend.name}`;
  }

  /** The kind of thing being talked to — sets what the operator expects. */
  get kind(): ConversationKind {
    return this.options.kind ?? this.backend.kind ?? "assistant";
  }

  /** The full transcript, for the analysis and the reports. */
  transcript(): readonly ClassifiedTurn[] {
    return this.turns;
  }

  /** How many times the operator had to say the same thing again. */
  repairs(): number {
    return this.repairAttempts;
  }

  attachOperator(persona: Persona): void {
    this.persona = persona;
  }

  async open(url: string, _viewport: Viewport): Promise<void> {
    if (url) this.address = url.startsWith("chat:") ? url : `chat:${url}`;
    this.openedAt = Date.now();
    this.turns = [];
    this.awaitingReply = false;
    this.lastLatencyMs = null;
    this.repairAttempts = 0;
    this.ended = false;
    this.lastOperatorMessage = null;
    this.opened = true;

    const greeting = await this.backend.open?.();
    if (greeting) this.recordReply(greeting);
  }

  /* ---------------------------------------------------------------- */
  /* Kernel-native perception                                          */
  /* ---------------------------------------------------------------- */

  async kernelPercept(): Promise<ConversationalKernelPercept> {
    this.requireOpen();
    const latest = this.turns.at(-1);
    const signals: SurfaceSignal[] = [];

    if (this.awaitingReply) signals.push({ type: "loading", active: true });

    if (latest?.speaker === "surface") {
      if (latest.notUnderstood) {
        signals.push({
          type: "not-understood",
          text: latest.text,
          // The surface said so itself, so the operator is not left guessing.
          confident: false,
        });
      } else if (this.answeredSomethingElse(latest)) {
        // The worse kind: no admission, just a reply about something else.
        // The operator only finds out by reading it.
        signals.push({
          type: "not-understood",
          text: latest.text,
          confident: true,
        });
      }
      if (latest.refused) {
        signals.push({ type: "error", text: latest.text, source: "surface" });
      }
    }

    if (this.ended) {
      signals.push({ type: "surface-terminated", reason: "The conversation was closed." });
    } else if (!this.awaitingReply) {
      signals.push({ type: "await-input", prompt: "Type a message…" });
    }

    return {
      modality: "conversational",
      timestamp: Date.now() - this.openedAt,
      frame: {
        address: this.address,
        label: this.backend.name,
        surfaceState: `${this.turns.length} turn(s)${this.repairAttempts > 0 ? `, ${this.repairAttempts} repair(s)` : ""}`,
      },
      affordances: this.affordances(),
      signals,
      turns: this.turns,
      recallWindow: this.recallWindow(),
      awaitingReply: this.awaitingReply,
      lastLatencyMs: this.lastLatencyMs,
      repairAttempts: this.repairAttempts,
    };
  }

  /**
   * What the operator can act on besides typing: the chips the surface
   * offered, and the way out to a person when it named one.
   *
   * Only the most recent surface turn contributes. A suggested reply from
   * four turns ago is gone from the interface, and offering it back would be
   * inventing an affordance the operator cannot see.
   */
  private affordances(): readonly Affordance[] {
    const latest = this.turns.at(-1);
    if (latest?.speaker !== "surface") return [];

    const offered = (latest.detail?.affordances ?? []) as
      | readonly { id: string; kind: string; label: string }[]
      | undefined;

    const affordances: Affordance[] = (offered ?? []).map((entry) => ({
      id: `${latest.id}:${entry.id}`,
      kind: entry.kind === "handoff" ? "chat.handoff" : "chat.suggestion",
      locator: { kind: "turn", index: this.turns.length - 1 },
      description: entry.label,
      state: { enabled: true, metadata: { offeredAt: this.turns.length - 1 } },
    }));

    if (latest.handoff && !affordances.some((a) => a.kind === "chat.handoff")) {
      affordances.push({
        id: `${latest.id}:handoff`,
        kind: "chat.handoff",
        locator: { kind: "turn", index: this.turns.length - 1 },
        description: "Reach a person",
        state: { enabled: true, metadata: { inferredFromText: true } },
      });
    }
    return affordances;
  }

  async actKernel(action: KernelAction): Promise<void> {
    this.requireOpen();
    switch (action.verb) {
      case "chat.say":
      case "chat.followup":
      case "chat.clarify":
        await this.say(textOf(action), { repair: false });
        return;
      case "chat.rephrase":
        // The operator says the same thing differently. That it is the same
        // thing is the whole point: it is what makes this a repair and not
        // a new question, and repairs are what wear a person down.
        await this.say(textOf(action), { repair: true });
        return;
      case "chat.escalate":
        await this.say(textOf(action) || "Can I speak to a human, please?", {
          repair: false,
        });
        return;
      case "read":
      case "wait":
        return;
      default:
        throw new Error(`conversation surface cannot "${action.verb}"`);
    }
  }

  /** Say something and record what comes back. */
  private async say(message: string, options: { repair: boolean }): Promise<void> {
    const text = message.trim();
    if (!text || this.ended) return;

    if (options.repair) this.repairAttempts += 1;
    this.turns.push({
      id: `t${this.turns.length}`,
      speaker: "operator",
      text,
      notUnderstood: false,
      refused: false,
      handoff: false,
    });
    this.lastOperatorMessage = text;

    this.awaitingReply = true;
    try {
      const reply = await this.backend.send(text);
      this.recordReply(reply);
    } catch (error) {
      // A transport failure mid-conversation is what the operator sees as
      // the bot dying on them. It is a turn, not an exception.
      this.recordReply({
        text: `The assistant stopped responding: ${
          error instanceof Error ? error.message : String(error)
        }`,
        refused: true,
        ended: true,
      });
    } finally {
      this.awaitingReply = false;
    }
  }

  private recordReply(reply: ConversationReply): void {
    const detected = detectNonAnswer(reply.text);
    const turn: ClassifiedTurn = {
      id: `t${this.turns.length}`,
      speaker: "surface",
      text: reply.text,
      notUnderstood: reply.notUnderstood ?? detected.notUnderstood,
      refused: reply.refused ?? detected.refused,
      handoff: offersHandoff(reply),
      ...(reply.latencyMs !== undefined ? { latencyMs: reply.latencyMs } : {}),
      ...(reply.affordances ? { detail: { affordances: reply.affordances } } : {}),
    };
    this.turns.push(turn);
    this.lastLatencyMs = reply.latencyMs ?? null;
    if (reply.ended) this.ended = true;
  }

  /**
   * True when the surface answered without admitting it missed — the reply
   * shares almost no vocabulary with what was asked.
   *
   * Deliberately conservative. A short reply ("Sure!", "Done.") is not
   * evidence of anything, and neither is a reply that reuses the operator's
   * own words. What this catches is the case people actually complain
   * about: a fluent, confident paragraph about a nearby topic.
   */
  private answeredSomethingElse(reply: ClassifiedTurn): boolean {
    if (!this.lastOperatorMessage || reply.refused) return false;
    return isNearMiss(this.lastOperatorMessage, reply.text);
  }

  /** How much of the conversation the operator still has in mind. */
  private recallWindow(): number {
    // Turns, not items: a person holds a handful of exchanges, and a long
    // conversation pushes the opening out of reach exactly as a long page
    // scrolls its top away.
    return workingMemoryCapacity(this.persona) * 2;
  }

  /* ---------------------------------------------------------------- */
  /* Deprecated web view                                               */
  /* ---------------------------------------------------------------- */

  async snapshot(): Promise<RawSnapshot> {
    const kernel = await this.kernelPercept();
    const percept = webPerceptFromKernel(kernel);
    return {
      url: percept.url,
      title: percept.title,
      viewport: percept.viewport,
      scrollY: percept.scrollY,
      scrollHeight: percept.scrollHeight,
      elements: percept.elements,
      dialogs: percept.dialogs,
      loadingIndicator: percept.loadingIndicator,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    return null;
  }

  async moveMouse(_point: Point): Promise<void> {
    // A conversation has no pointer.
  }

  /** Clicking a suggested reply is saying it — which is what a chip is. */
  async clickAt(point: Point): Promise<void> {
    const kernel = await this.kernelPercept();
    const percept = webPerceptFromKernel(kernel);
    const hit = percept.elements.find(
      (element) =>
        element.interactive &&
        point.x >= element.box.x &&
        point.x <= element.box.x + element.box.width &&
        point.y >= element.box.y &&
        point.y <= element.box.y + element.box.height,
    );
    if (hit?.text) await this.say(hit.text, { repair: false });
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.clickAt(point);
  }

  /**
   * The legacy typing path. Text is buffered rather than sent, because a
   * person composes a whole message before pressing Enter — sending each
   * keystroke would be a different (and much worse) product.
   */
  private composing = "";

  async typeText(text: string, _perCharIntervalMs: number): Promise<void> {
    this.composing += text;
  }

  async pressKey(key: string): Promise<void> {
    if (key === "Enter") {
      const message = this.composing;
      this.composing = "";
      await this.say(message, { repair: false });
    } else if (key === "Backspace") {
      this.composing = this.composing.slice(0, -1);
    }
  }

  async scrollBy(_deltaY: number): Promise<void> {
    // Scrollback is perceivable but changes nothing about the conversation.
  }

  async goBack(): Promise<void> {
    // A dialogue has no back button. That is the point of the modality.
  }

  async navigate(url: string): Promise<void> {
    await this.open(url, { width: 0, height: 0 });
  }

  async close(): Promise<void> {
    await this.backend.close?.();
    this.opened = false;
  }

  private requireOpen(): void {
    if (!this.opened) {
      throw new Error("ConversationAdapter: open() the conversation before using it");
    }
  }
}

/** The message a kernel action carries, from `target` or `payload`. */
function textOf(action: KernelAction): string {
  if (typeof action.payload === "string") return action.payload;
  if (
    typeof action.payload === "object" &&
    action.payload !== null &&
    typeof (action.payload as { message?: unknown }).message === "string"
  ) {
    return (action.payload as { message: string }).message;
  }
  return typeof action.target === "string" ? action.target : "";
}
