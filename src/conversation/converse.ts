/**
 * `converse` — the one call that talks to something like a human would.
 *
 * Wires the pieces the way `eve run` wires a browser session and `eve read`
 * wires a reading one: a conversation adapter over a backend, the session
 * loop for the moment-to-moment experience, and the conversation plugin for
 * the judgment formed across the whole transcript. What comes back is an
 * ordinary `SessionResult` — scored, evidence-backed, renderable by every
 * existing report — with the transcript and the analysis alongside.
 *
 * Getting an answer is modelled as success: the operator's goal signals are
 * matched against what the surface actually said, so a conversation that
 * resolved ends `goal-achieved` and one the person walked away from ends
 * `abandoned`. That distinction is the whole point of measuring a bot.
 */

import type { ConversationTurn } from "../core/kernel.js";
import { EveSession, type SessionOptions, type SessionResult } from "../engine/session.js";
import { getPersona } from "../personas/library.js";
import type { Persona } from "../personas/persona.js";
import type { EvePlugin } from "../plugins/plugin.js";
import { ConversationAdapter } from "./adapter.js";
import { analyzeConversation, type ConversationAnalysis } from "./analysis.js";
import { ConversationPlugin } from "./plugin.js";
import type { ConversationBackend, ConversationKind } from "./types.js";
import { registerConversationVocabulary } from "./vocabulary.js";

export interface ConverseOptions
  extends Omit<Partial<SessionOptions>, "adapter" | "startUrl" | "persona"> {
  readonly persona?: Persona | string;
  /** What the operator is talking to; overrides what the backend reports. */
  readonly kind?: ConversationKind;
  /** Operator-visible address for reports. */
  readonly address?: string;
  readonly plugins?: readonly EvePlugin[];
}

export interface ConversationResult extends SessionResult {
  readonly transcript: readonly ConversationTurn[];
  readonly conversation: ConversationAnalysis;
}

/**
 * Have a conversation with a backend and report the experience.
 *
 * `goal` is what the operator came for — it becomes their opening line, so
 * it should read the way a person would say it ("get a refund for a double
 * charge"), not the way a test case would.
 */
export async function converse(
  backend: ConversationBackend,
  options: ConverseOptions = {},
): Promise<ConversationResult> {
  registerConversationVocabulary();

  const persona: Persona =
    typeof options.persona === "string"
      ? getPersona(options.persona)
      : (options.persona ?? getPersona("first-time-user"));

  const address = options.address ?? `chat:${backend.name}`;
  const goal = options.goal ?? "get help with my problem";

  const adapter = new ConversationAdapter({
    backend,
    persona,
    ...(options.kind ? { kind: options.kind } : {}),
    address,
  });

  const conversation = new ConversationPlugin(adapter, { goal });

  const { kind: _kind, address: _address, plugins, ...sessionOptions } = options;
  const session = new EveSession({
    ...sessionOptions,
    adapter,
    startUrl: address,
    persona,
    plugins: [conversation, ...(plugins ?? [])],
    goal,
    // A conversation turns one exchange per step; a person who has not got
    // there in a couple of dozen turns has long since stopped trying.
    maxSteps: options.maxSteps ?? 24,
    screenshots: false,
    // Backend latency is real and measured, but the operator's own pacing —
    // reading, composing, hesitating — is simulated, so runs stay replayable.
    deterministic: options.deterministic ?? true,
  });

  const result = await session.run();
  const transcript = adapter.transcript();
  const analysis =
    conversation.result() ??
    analyzeConversation({
      address,
      kind: adapter.kind,
      turns: transcript,
      repairAttempts: adapter.repairs(),
      persona,
      goalAchieved: result.goalAchieved,
      goal,
    });

  return { ...result, transcript, conversation: analysis };
}
