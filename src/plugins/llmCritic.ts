import type { Percept } from "../core/types.js";
import type { EvePlugin, PluginContext } from "./plugin.js";
import { visibleText } from "../cognition/mentalModel.js";

/**
 * LLM Critic plugin (optional): a design-review pass powered by the
 * Anthropic API. Once per unique screen it shows the model the screenshot
 * (when available) plus the visible text, and asks for expert UX critique in
 * a structured shape that maps directly onto findings.
 *
 * Requires the optional peer dependency `@anthropic-ai/sdk`; if unavailable
 * the plugin is silently inert.
 */

export interface LlmCriticOptions {
  model?: string;
  apiKey?: string;
  /** Max screens to critique per session (cost control). */
  maxScreens?: number;
}

interface CritiqueShape {
  issues: Array<{
    severity: "critical" | "major" | "minor";
    title: string;
    description: string;
    recommendation: string;
  }>;
}

const CRITIQUE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          title: { type: "string" },
          description: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["severity", "title", "description", "recommendation"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
} as const;

export class LlmCriticPlugin implements EvePlugin {
  readonly name = "llm-critic";
  private client: unknown | null = null;
  private loadFailed = false;
  private readonly critiqued = new Set<string>();
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly maxScreens: number;

  constructor(options: LlmCriticOptions = {}) {
    this.model = options.model ?? "claude-opus-4-8";
    this.apiKey = options.apiKey;
    this.maxScreens = options.maxScreens ?? 5;
  }

  async onPercept(ctx: PluginContext, percept: Percept): Promise<void> {
    if (this.critiqued.size >= this.maxScreens) return;
    const key = percept.url;
    if (this.critiqued.has(key)) return;
    this.critiqued.add(key);

    const client = await this.getClient();
    if (!client) return;

    const content: Array<Record<string, unknown>> = [];
    if (percept.screenshot) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: percept.screenshot.toString("base64"),
        },
      });
    }
    content.push({
      type: "text",
      text: [
        `You are a principal UX designer reviewing one screen of a product.`,
        `URL: ${percept.url}`,
        `Title: ${percept.title}`,
        `Visible text (extracted): ${visibleText(percept).slice(0, 3000)}`,
        ``,
        `List concrete UX/design issues visible on this screen. Be specific and actionable; skip generic advice. Return an empty list if the screen is genuinely fine.`,
      ].join("\n"),
    });

    try {
      const response = await (client as {
        messages: {
          create: (params: Record<string, unknown>) => Promise<{
            stop_reason?: string;
            content: Array<{ type: string; text?: string }>;
          }>;
        };
      }).messages.create({
        model: this.model,
        max_tokens: 2048,
        output_config: { format: { type: "json_schema", schema: CRITIQUE_SCHEMA } },
        messages: [{ role: "user", content }],
      });
      if (response.stop_reason === "refusal") return;
      const text = response.content.find((b) => b.type === "text")?.text;
      if (!text) return;
      const parsed = JSON.parse(text) as CritiqueShape;
      for (const issue of parsed.issues.slice(0, 6)) {
        ctx.report({
          severity: issue.severity,
          category: "usability",
          title: `[LLM critic] ${issue.title}`,
          description: issue.description,
          evidence: [`Screen: ${percept.title || percept.url}`, "Source: LLM design critique"],
          url: percept.url,
          recommendation: issue.recommendation,
        });
      }
    } catch {
      /* critique is best-effort; never disturb the session */
    }
  }

  private async getClient(): Promise<unknown | null> {
    if (this.client) return this.client;
    if (this.loadFailed) return null;
    try {
      // Variable specifier: optional peer — must not be resolved at compile time.
      const spec = "@anthropic-ai/sdk";
      const mod = (await import(spec)) as {
        default: new (opts?: { apiKey?: string }) => unknown;
      };
      this.client = this.apiKey ? new mod.default({ apiKey: this.apiKey }) : new mod.default();
      return this.client;
    } catch {
      this.loadFailed = true;
      return null;
    }
  }
}
