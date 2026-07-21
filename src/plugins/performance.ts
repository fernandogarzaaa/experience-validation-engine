import type { Percept, PredictionOutcome } from "../core/types.js";
import type { EvePlugin, PluginContext } from "./plugin.js";

/**
 * Performance plugin: reports on *perceived* performance — the waits a human
 * actually experiences — rather than synthetic metrics.
 */
export class PerformancePlugin implements EvePlugin {
  readonly name = "performance";
  private readonly latencies: number[] = [];
  private slowReported = new Set<string>();

  async onOutcome(
    ctx: PluginContext,
    outcome: PredictionOutcome,
    percept: Percept,
  ): Promise<void> {
    this.latencies.push(outcome.perceivedLatencyMs);
    const seconds = outcome.perceivedLatencyMs / 1000;
    if (seconds > 3 && !this.slowReported.has(percept.url)) {
      this.slowReported.add(percept.url);
      ctx.report({
        severity: seconds > 8 ? "major" : "minor",
        category: "performance",
        title: `A ${seconds.toFixed(1)}s wait after acting on ${shortUrl(percept.url)}`,
        description: `The operator acted and then watched a loading state for ${seconds.toFixed(1)} seconds before the screen settled. Waits beyond ~1s break flow; beyond ~10s users assume failure.`,
        evidence: [`Perceived latency: ${outcome.perceivedLatencyMs}ms`, `Screen: ${percept.title || percept.url}`],
        url: percept.url,
        recommendation: "Show immediate feedback (<100ms), keep interactions under 1s, and show determinate progress for anything longer.",
      });
    }
  }

  async onSessionEnd(ctx: PluginContext): Promise<void> {
    if (this.latencies.length < 3) return;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    if (p90 > 2000) {
      ctx.report({
        severity: "minor",
        category: "performance",
        title: `Sluggish overall feel: p90 perceived latency ${Math.round(p90)}ms`,
        description:
          "Across the whole session, one in ten interactions kept the operator waiting more than two seconds — the product feels slow even if no single wait is dramatic.",
        evidence: [
          `p50=${Math.round(sorted[Math.floor(sorted.length * 0.5)]!)}ms, p90=${Math.round(p90)}ms over ${this.latencies.length} interactions`,
        ],
        url: ctx.startUrl,
      });
    }
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host : u.pathname;
  } catch {
    return url.slice(0, 60);
  }
}
