import { clamp01 } from "../core/random.js";
import type {
  CognitiveContext,
  Decision,
  DecisionPolicy,
  FallbackReportingPolicy,
} from "./cognition.js";
import { HeuristicCognition } from "./heuristicCognition.js";

/**
 * Optional LLM-backed decision policy, powered by the Anthropic API.
 *
 * The LLM plays the persona: it receives only what the operator could see
 * (the percept, rendered as text) plus the operator's own internal state
 * (goal, emotions, memory highlights) — never privileged application data —
 * and returns one structured decision per loop iteration.
 *
 * `@anthropic-ai/sdk` is an optional peer dependency, imported dynamically.
 * If it is missing, or a call fails, the policy degrades gracefully to the
 * built-in heuristic policy so a simulation never dies mid-run.
 */

export interface LlmCognitionOptions {
  /** Anthropic model id. */
  model?: string;
  /** API key; defaults to the SDK's environment resolution. */
  apiKey?: string;
  maxTokens?: number;
  /**
   * Per-request timeout passed to the Anthropic client, in ms. Without this,
   * a hung call can ride the SDK's own ~10-minute default (times retries),
   * and because the session's wall-clock budget is only checked between loop
   * iterations, one hung call can blow through the whole session's budget.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface LlmDecisionShape {
  action: "click" | "type" | "press" | "scroll" | "back" | "wait" | "read" | "abandon";
  elementId?: number;
  text?: string;
  key?: string;
  rationale: string;
  expectedOutcome: string;
  expectedSignals: string[];
  confidence: number;
}

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["click", "type", "press", "scroll", "back", "wait", "read", "abandon"],
    },
    elementId: { type: "integer" },
    text: { type: "string" },
    key: { type: "string" },
    rationale: { type: "string" },
    expectedOutcome: { type: "string" },
    expectedSignals: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["action", "rationale", "expectedOutcome", "expectedSignals", "confidence"],
  additionalProperties: false,
} as const;

export class LlmCognition implements DecisionPolicy, FallbackReportingPolicy {
  readonly name = "llm";
  private readonly fallback = new HeuristicCognition();
  private client: unknown | null = null;
  private clientLoadFailed = false;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private pendingFallbackReason: string | null = null;

  constructor(options: LlmCognitionOptions = {}) {
    this.model = options.model ?? "claude-opus-4-8";
    this.apiKey = options.apiKey;
    this.maxTokens = options.maxTokens ?? 1024;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Consumed on read — see {@link FallbackReportingPolicy}. */
  takeFallbackReason(): string | null {
    const reason = this.pendingFallbackReason;
    this.pendingFallbackReason = null;
    return reason;
  }

  private fallbackTo(ctx: CognitiveContext, reason: string): Promise<Decision> {
    this.pendingFallbackReason = `${reason} — falling back to heuristic cognition.`;
    return this.fallback.decide(ctx);
  }

  async decide(ctx: CognitiveContext): Promise<Decision> {
    const client = await this.getClient();
    if (!client) {
      // getClient() has already set pendingFallbackReason for a load/construct
      // failure; nothing to add here.
      return this.fallback.decide(ctx);
    }
    try {
      const response = await (
        client as {
          messages: {
            create: (
              params: Record<string, unknown>,
              options: { timeout: number },
            ) => Promise<{
              stop_reason?: string;
              content: Array<{ type: string; text?: string }>;
            }>;
          };
        }
      ).messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: this.systemPrompt(ctx),
          output_config: { format: { type: "json_schema", schema: DECISION_SCHEMA } },
          messages: [{ role: "user", content: this.scenePrompt(ctx) }],
        },
        { timeout: this.timeoutMs },
      );
      if (response.stop_reason === "refusal") {
        return this.fallbackTo(ctx, "the model refused to respond");
      }
      const text = response.content.find((b) => b.type === "text")?.text;
      if (!text) return this.fallbackTo(ctx, "the model's response contained no text content");
      const parsed = JSON.parse(text) as LlmDecisionShape;
      const mapped = this.toDecision(parsed, ctx);
      if (mapped) return mapped;
      return this.fallbackTo(ctx, "the model's response could not be mapped to a valid action");
    } catch (error) {
      return this.fallbackTo(
        ctx,
        `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getClient(): Promise<unknown | null> {
    if (this.client) return this.client;
    if (this.clientLoadFailed) return null;
    try {
      // Variable specifier: optional peer — must not be resolved at compile time.
      const spec = "@anthropic-ai/sdk";
      const mod = (await import(spec)) as {
        default: new (opts?: { apiKey?: string }) => unknown;
      };
      this.client = this.apiKey ? new mod.default({ apiKey: this.apiKey }) : new mod.default();
      return this.client;
    } catch (error) {
      this.clientLoadFailed = true;
      this.pendingFallbackReason = `Anthropic client is unavailable: ${error instanceof Error ? error.message : String(error)} — falling back to heuristic cognition.`;
      return null;
    }
  }

  private systemPrompt(ctx: CognitiveContext): string {
    const p = ctx.persona;
    return [
      "You are role-playing a real human using a piece of software. Stay strictly in character.",
      `Persona: ${p.name} — ${p.description}`,
      `Traits (0..1): patience=${p.traits.patience}, techLiteracy=${p.traits.techLiteracy}, curiosity=${p.traits.curiosity}, riskTolerance=${p.traits.riskTolerance}, thoroughness=${p.traits.thoroughness}, keyboardPreference=${p.traits.keyboardPreference}.`,
      "You only know what you can see on screen. You cannot inspect code, network traffic, or anything a human could not perceive.",
      `Each turn, choose exactly one next action and predict what will happen. Rationale must be first-person, in the persona's voice.`,
      `If your frustration is beyond what this persona would tolerate, choose "abandon".`,
    ].join("\n");
  }

  private scenePrompt(ctx: CognitiveContext): string {
    const { percept, emotion, goals, memory } = ctx;
    const lines: string[] = [];
    lines.push(`Goal: ${goals.current.description}`);
    if (goals.subgoal) lines.push(`Subgoal: ${goals.subgoal.description}`);
    lines.push(
      `Emotions (0..1): frustration=${emotion.frustration.toFixed(2)}, confidence=${emotion.confidence.toFixed(2)}, confusion=${emotion.confusion.toFixed(2)}, curiosity=${emotion.curiosity.toFixed(2)}, fatigue=${emotion.fatigue.toFixed(2)}.`,
    );
    const thoughts = memory.currentThoughts().map((t) => t.content);
    if (thoughts.length) lines.push(`In mind: ${thoughts.join("; ")}`);
    const facts = memory
      .knownFacts()
      .slice(0, 6)
      .map((f) => f.statement);
    if (facts.length) lines.push(`Learned so far: ${facts.join("; ")}`);
    lines.push("");
    lines.push(`Screen — URL: ${percept.url}`);
    lines.push(`Title: ${percept.title}`);
    if (percept.loadingIndicator) lines.push("A loading indicator is visible.");
    for (const d of percept.dialogs) lines.push(`DIALOG: ${d.text.slice(0, 200)}`);
    lines.push(`Visible elements (id role "text" [flags]):`);
    for (const el of percept.elements.slice(0, 80)) {
      const flags = [
        el.interactive ? "interactive" : "",
        el.editable ? "editable" : "",
        el.disabled ? "disabled" : "",
        el.focused ? "focused" : "",
      ]
        .filter(Boolean)
        .join(",");
      const text = el.text.trim().replace(/\s+/g, " ").slice(0, 90);
      lines.push(`  ${el.id} ${el.role} "${text}"${flags ? ` [${flags}]` : ""}`);
    }
    const canScroll = percept.scrollY + percept.viewport.height < percept.scrollHeight - 40;
    lines.push(canScroll ? "More content exists below the fold." : "You can see the whole page.");
    lines.push("");
    lines.push(
      `Respond with your single next action. For "click"/"type" include elementId; for "type" include text; for "press" include key.`,
    );
    return lines.join("\n");
  }

  private toDecision(parsed: LlmDecisionShape, ctx: CognitiveContext): Decision | null {
    const find = (id: number | undefined) =>
      id === undefined ? undefined : ctx.percept.elements.find((e) => e.id === id);
    const prediction = {
      description: parsed.expectedOutcome,
      expectedSignals: parsed.expectedSignals.slice(0, 6),
      expectsChange: parsed.action !== "read" && parsed.action !== "wait",
      confidence: clamp01(parsed.confidence),
    };
    const base = { rationale: parsed.rationale, prediction, effort: 0.3 };
    switch (parsed.action) {
      case "click": {
        const el = find(parsed.elementId);
        if (!el) return null;
        return { ...base, action: { kind: "click", target: el } };
      }
      case "type": {
        const el = find(parsed.elementId);
        if (!el || typeof parsed.text !== "string") return null;
        return { ...base, action: { kind: "type", target: el, text: parsed.text } };
      }
      case "press":
        if (!parsed.key) return null;
        return { ...base, action: { kind: "press", key: parsed.key } };
      case "scroll":
        return {
          ...base,
          action: { kind: "scroll", deltaY: Math.round(ctx.percept.viewport.height * 0.8) },
        };
      case "back":
        return { ...base, action: { kind: "back" } };
      case "wait":
        return { ...base, action: { kind: "wait", durationMs: 1200 } };
      case "read":
        return { ...base, action: { kind: "read", target: null, durationMs: 1500 } };
      case "abandon":
        return { ...base, action: { kind: "abandon", reason: parsed.rationale } };
      default:
        return null;
    }
  }
}
