/**
 * The HTTP backend — a real chat endpoint.
 *
 * Chat APIs have not converged on a shape, so this deliberately does not
 * pretend they have: it posts a body built from a template and reads the
 * reply out of the response by path. Two shapes are pre-declared because
 * between them they cover most of what people actually deploy — an
 * OpenAI-style `choices[0].message.content` and a plain `{reply}` — and
 * anything else is a `replyPath` away.
 *
 * Latency here is *measured*, not modelled: this is one of the few places
 * EVE gets to observe a real duration rather than simulate one, and how long
 * a bot takes to answer is a large part of how it feels.
 */

import type {
  ConversationAffordance,
  ConversationBackend,
  ConversationKind,
  ConversationReply,
} from "../types.js";
import { detectNonAnswer } from "../types.js";

export interface HttpBackendOptions {
  readonly url: string;
  readonly method?: "POST" | "GET";
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Body template. `{{message}}` is replaced with what the operator said,
   * JSON-escaped. Defaults to `{"message": "{{message}}"}`.
   */
  readonly bodyTemplate?: string;
  /**
   * Dotted path to the reply text in the response, e.g.
   * `choices.0.message.content`. Defaults to trying the common shapes.
   */
  readonly replyPath?: string;
  readonly kind?: ConversationKind;
  readonly timeoutMs?: number;
  /** Inject a fetch implementation (tests, proxies). */
  readonly fetchImpl?: typeof fetch;
}

/** Paths real chat APIs put their reply text at, tried in order. */
const COMMON_REPLY_PATHS = [
  "reply",
  "message",
  "text",
  "answer",
  "output",
  "response",
  "content",
  "choices.0.message.content",
  "choices.0.text",
  "candidates.0.content.parts.0.text",
  "messages.0.content",
  "data.reply",
  "result.reply",
];

const DEFAULT_TIMEOUT_MS = 30_000;

export class HttpBackend implements ConversationBackend {
  readonly name = "http";
  readonly kind: ConversationKind;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HttpBackendOptions) {
    this.kind = options.kind ?? "assistant";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(message: string): Promise<ConversationReply> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // The operator's clock starts when they hit send, not when the server
    // starts working — so a timeout is measured the same way a wait is.
    const started = Date.now();

    try {
      const method = this.options.method ?? "POST";
      const template = this.options.bodyTemplate ?? '{"message": "{{message}}"}';
      const body = template.replaceAll("{{message}}", jsonEscape(message));

      // A GET carries no body, so the message has to go in the query string
      // or it goes nowhere: every turn would be an identical bodyless
      // request, and EVE would report the endpoint as ignoring the person
      // when in fact it was never told what they said.
      const url = method === "GET" ? withMessageQuery(this.options.url, message) : this.options.url;

      const response = await this.fetchImpl(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.options.headers ?? {}),
        },
        ...(method === "POST" ? { body } : {}),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      if (!response.ok) {
        // A 500 from a chat endpoint is not an exception to the operator —
        // it is the surface failing to answer, in the middle of a sentence.
        return {
          text: `The assistant is unavailable (${response.status} ${response.statusText}).`,
          latencyMs,
          refused: true,
        };
      }

      const raw = await response.text();
      const text = extractReply(raw, this.options.replyPath);
      const { notUnderstood, refused } = detectNonAnswer(text);
      return {
        text,
        latencyMs,
        ...(notUnderstood ? { notUnderstood: true } : {}),
        ...(refused ? { refused: true } : {}),
        ...(extractAffordances(raw) ?? {}),
      };
    } catch (error) {
      const latencyMs = Date.now() - started;
      const timedOut = error instanceof Error && error.name === "AbortError";
      return {
        text: timedOut
          ? `The assistant did not respond within ${Math.round(timeoutMs / 1000)}s.`
          : `The assistant could not be reached: ${
              error instanceof Error ? error.message : String(error)
            }`,
        latencyMs,
        refused: true,
        ended: !timedOut,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Pull the reply text out of whatever shape the endpoint returned. */
export function extractReply(raw: string, replyPath?: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A plain-text endpoint is a perfectly good chat endpoint.
    return raw.trim();
  }

  if (typeof parsed === "string") return parsed;

  if (replyPath) {
    const value = readPath(parsed, replyPath);
    if (typeof value === "string") return value;
    // A declared path that does not resolve is a caller error worth naming,
    // not something to paper over with a silent fallback.
    return `(the assistant's reply was not found at "${replyPath}")`;
  }

  for (const path of COMMON_REPLY_PATHS) {
    const value = readPath(parsed, path);
    if (typeof value === "string" && value.trim()) return value;
  }
  return raw.trim();
}

/** Suggested replies, when the endpoint offers them in a recognizable shape. */
function extractAffordances(
  raw: string,
): { affordances: readonly ConversationAffordance[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  for (const key of ["suggestions", "quickReplies", "quick_replies", "chips", "options"]) {
    const value = readPath(parsed, key);
    if (!Array.isArray(value)) continue;
    const affordances = value
      .map((entry, index): ConversationAffordance | null => {
        const label =
          typeof entry === "string"
            ? entry
            : typeof (entry as { label?: unknown })?.label === "string"
              ? (entry as { label: string }).label
              : typeof (entry as { title?: unknown })?.title === "string"
                ? (entry as { title: string }).title
                : null;
        return label ? { id: `s${index}`, kind: "suggestion", label } : null;
      })
      .filter((a): a is ConversationAffordance => a !== null);
    if (affordances.length > 0) return { affordances };
  }
  return null;
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = Array.isArray(current)
      ? current[Number(key)]
      : (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Put the operator's message in the query string, for GET endpoints. */
function withMessageQuery(url: string, message: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("message", message);
    return parsed.toString();
  } catch {
    // A relative or malformed URL still has to carry the message somewhere.
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}message=${encodeURIComponent(message)}`;
  }
}

function jsonEscape(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}
