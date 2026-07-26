import type {
  Finding,
  LoopIteration,
  Percept,
  PredictionOutcome,
} from "../core/types.js";
import type { Persona } from "../personas/persona.js";
import type { SurfaceCapabilities } from "../surface/capabilities.js";

/**
 * Plugin system.
 *
 * Plugins are passive observers with one power: reporting findings. They see
 * the same percepts and outcomes the operator does (plus session metadata)
 * and contribute domain-specific judgment — accessibility review, performance
 * review, LLM critique, localization checks — without ever influencing the
 * operator's behavior. That separation keeps simulations comparable across
 * plugin configurations.
 */

export interface PluginContext {
  readonly persona: Persona;
  readonly startUrl: string;
  /** Which perceptual dimensions the current surface actually has. */
  readonly capabilities: SurfaceCapabilities;
  /** Report a finding into the session. Deduplicated by (title, url). */
  report(finding: Omit<Finding, "id" | "timestamp">): void;
}

export interface EvePlugin {
  readonly name: string;
  /** Called once before the loop starts. */
  onSessionStart?(ctx: PluginContext): void | Promise<void>;
  /** Called for every settled percept. */
  onPercept?(ctx: PluginContext, percept: Percept, step: number): void | Promise<void>;
  /** Called after each action's outcome is known. */
  onOutcome?(
    ctx: PluginContext,
    outcome: PredictionOutcome,
    percept: Percept,
    step: number,
  ): void | Promise<void>;
  /** Called once when the loop finishes, with the full iteration record. */
  onSessionEnd?(
    ctx: PluginContext,
    iterations: readonly LoopIteration[],
  ): void | Promise<void>;
}

export class PluginManager {
  private readonly plugins: EvePlugin[] = [];

  constructor(private readonly onError: (err: unknown, plugin: string) => void = () => {}) {}

  register(plugin: EvePlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.push(plugin);
  }

  list(): readonly EvePlugin[] {
    return this.plugins;
  }

  async sessionStart(ctx: PluginContext): Promise<void> {
    await this.each((p) => p.onSessionStart?.(ctx));
  }

  async percept(ctx: PluginContext, percept: Percept, step: number): Promise<void> {
    await this.each((p) => p.onPercept?.(ctx, percept, step));
  }

  async outcome(
    ctx: PluginContext,
    outcome: PredictionOutcome,
    percept: Percept,
    step: number,
  ): Promise<void> {
    await this.each((p) => p.onOutcome?.(ctx, outcome, percept, step));
  }

  async sessionEnd(ctx: PluginContext, iterations: readonly LoopIteration[]): Promise<void> {
    await this.each((p) => p.onSessionEnd?.(ctx, iterations));
  }

  private async each(fn: (plugin: EvePlugin) => void | Promise<void>): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await fn(plugin);
      } catch (err) {
        this.onError(err, plugin.name);
      }
    }
  }
}
