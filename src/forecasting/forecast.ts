import type { SessionResult } from "../engine/session.js";
import type { Finding } from "../core/types.js";

/**
 * Experience forecasting.
 *
 * From one or more observed sessions, forecast where *future* users are
 * likely to struggle, which workflows risk abandonment, which screens erode
 * confidence, and what changes would most improve completion. This is
 * predictive UX analytics grounded in observed behavior rather than opinion:
 * screens that repeatedly produced surprise, dead clicks, latency spikes,
 * confidence drops or abandonment across sessions are extrapolated into
 * risk forecasts, weighted by how many personas hit them.
 */

export interface StruggleForecast {
  /** Screen title or URL where struggle is predicted. */
  readonly location: string;
  /** 0..1 predicted probability a user struggles here. */
  readonly struggleProbability: number;
  /** What drives the prediction. */
  readonly signals: readonly string[];
  /** Personas that struggled here, if multi-session. */
  readonly affectedPersonas: readonly string[];
}

export interface AbandonmentForecast {
  readonly workflow: string;
  readonly abandonmentRisk: number;
  readonly reason: string;
}

export interface ConfidenceForecast {
  readonly location: string;
  /** Mean confidence drop observed on this screen. */
  readonly confidenceDrop: number;
}

export interface ImprovementForecast {
  readonly change: string;
  /** Estimated completion-rate lift, 0..1. */
  readonly estimatedLift: number;
  readonly rationale: string;
}

export interface ExperienceForecast {
  readonly struggles: readonly StruggleForecast[];
  readonly abandonmentRisks: readonly AbandonmentForecast[];
  readonly confidenceDrains: readonly ConfidenceForecast[];
  readonly recommendedChanges: readonly ImprovementForecast[];
  readonly summary: string;
}

interface ScreenStats {
  location: string;
  visits: number;
  surprises: number;
  deadClicks: number;
  errors: number;
  latencySpikes: number;
  confidenceDropSum: number;
  confidenceDropCount: number;
  personas: Set<string>;
}

/**
 * Forecast future UX risk from a set of observed sessions (one or many
 * personas / seeds). More sessions → higher-confidence forecasts.
 */
export function forecastExperience(sessions: readonly SessionResult[]): ExperienceForecast {
  if (sessions.length === 0) {
    return {
      struggles: [],
      abandonmentRisks: [],
      confidenceDrains: [],
      recommendedChanges: [],
      summary: "No sessions provided — nothing to forecast.",
    };
  }

  const byScreen = new Map<string, ScreenStats>();
  const workflowAbandon = new Map<string, { entries: number; abandonedOn: number; reason: string }>();

  for (const session of sessions) {
    const titleByUrl = new Map<string, string>();
    for (const node of session.workflowNodes) titleByUrl.set(node.url, node.title || node.url);

    let prevConfidence: number | null = null;
    for (const it of session.iterations) {
      const location = titleByUrl.get(it.url) ?? it.url;
      const stats = byScreen.get(location) ?? {
        location,
        visits: 0,
        surprises: 0,
        deadClicks: 0,
        errors: 0,
        latencySpikes: 0,
        confidenceDropSum: 0,
        confidenceDropCount: 0,
        personas: new Set<string>(),
      };
      stats.visits += 1;
      stats.personas.add(session.personaName);
      const o = it.outcome;
      if (o) {
        if (o.surprise > 0.6) stats.surprises += 1;
        if (o.prediction.expectsChange && !o.screenChanged) stats.deadClicks += 1;
        if (o.errorPerceived) stats.errors += 1;
        if (o.perceivedLatencyMs > 3000) stats.latencySpikes += 1;
      }
      const confidence = (it.emotion as Record<string, number>).confidence ?? 0.5;
      if (prevConfidence !== null && confidence < prevConfidence) {
        stats.confidenceDropSum += prevConfidence - confidence;
        stats.confidenceDropCount += 1;
      }
      prevConfidence = confidence;
      byScreen.set(location, stats);
    }

    // Abandonment attribution to the workflow of the last screen.
    if (session.abandoned) {
      const last = session.iterations[session.iterations.length - 1];
      const kind =
        session.workflowNodes.find((n) => n.url === last?.url)?.kind ?? "unknown";
      const entry = workflowAbandon.get(kind) ?? { entries: 0, abandonedOn: 0, reason: session.abandonReason ?? "" };
      entry.abandonedOn += 1;
      entry.reason = session.abandonReason ?? entry.reason;
      workflowAbandon.set(kind, entry);
    }
    for (const wf of session.workflows) {
      const entry = workflowAbandon.get(wf.kind) ?? { entries: 0, abandonedOn: 0, reason: "" };
      entry.entries += 1;
      workflowAbandon.set(wf.kind, entry);
    }
  }

  const n = sessions.length;
  const struggles: StruggleForecast[] = [];
  const confidenceDrains: ConfidenceForecast[] = [];

  for (const stats of byScreen.values()) {
    const frictionEvents = stats.surprises + stats.deadClicks * 1.5 + stats.errors * 2 + stats.latencySpikes;
    const personaBreadth = stats.personas.size / n; // hit across the population
    const probability = clamp01((frictionEvents / Math.max(1, stats.visits)) * 0.6 + personaBreadth * 0.4);
    if (probability > 0.25) {
      const signals: string[] = [];
      if (stats.errors > 0) signals.push(`${stats.errors} error(s)`);
      if (stats.deadClicks > 0) signals.push(`${stats.deadClicks} dead click(s)`);
      if (stats.surprises > 0) signals.push(`${stats.surprises} expectation violation(s)`);
      if (stats.latencySpikes > 0) signals.push(`${stats.latencySpikes} slow response(s)`);
      struggles.push({
        location: stats.location,
        struggleProbability: Number(probability.toFixed(2)),
        signals,
        affectedPersonas: [...stats.personas],
      });
    }
    if (stats.confidenceDropCount > 0) {
      const drop = stats.confidenceDropSum / stats.confidenceDropCount;
      if (drop > 0.05) confidenceDrains.push({ location: stats.location, confidenceDrop: Number(drop.toFixed(3)) });
    }
  }
  struggles.sort((a, b) => b.struggleProbability - a.struggleProbability);
  confidenceDrains.sort((a, b) => b.confidenceDrop - a.confidenceDrop);

  const abandonmentRisks: AbandonmentForecast[] = [];
  for (const [kind, entry] of workflowAbandon) {
    if (entry.entries === 0 && entry.abandonedOn === 0) continue;
    const risk = clamp01(entry.abandonedOn / Math.max(1, n));
    if (risk > 0) {
      abandonmentRisks.push({
        workflow: kind,
        abandonmentRisk: Number(risk.toFixed(2)),
        reason: entry.reason || "friction accumulated in this workflow",
      });
    }
  }
  abandonmentRisks.sort((a, b) => b.abandonmentRisk - a.abandonmentRisk);

  const recommendedChanges = recommendChanges(struggles, confidenceDrains, sessions);

  const summary = buildSummary(struggles, abandonmentRisks, sessions.length);

  return {
    struggles: struggles.slice(0, 10),
    abandonmentRisks: abandonmentRisks.slice(0, 6),
    confidenceDrains: confidenceDrains.slice(0, 6),
    recommendedChanges,
    summary,
  };
}

function recommendChanges(
  struggles: readonly StruggleForecast[],
  drains: readonly ConfidenceForecast[],
  sessions: readonly SessionResult[],
): ImprovementForecast[] {
  const out: ImprovementForecast[] = [];
  const allFindings: Finding[] = sessions.flatMap((s) => [...s.findings]);

  const deadClickScreens = struggles.filter((s) => s.signals.some((g) => g.includes("dead click")));
  if (deadClickScreens.length > 0) {
    out.push({
      change: `Add immediate visible feedback to controls on: ${deadClickScreens.slice(0, 3).map((s) => s.location).join(", ")}`,
      estimatedLift: Math.min(0.3, deadClickScreens.length * 0.08),
      rationale: "Dead clicks (no visible response) are the strongest single predictor of confidence loss and re-clicking here.",
    });
  }
  const errorScreens = struggles.filter((s) => s.signals.some((g) => g.includes("error")));
  if (errorScreens.length > 0) {
    out.push({
      change: `Improve error prevention and recovery on: ${errorScreens.slice(0, 3).map((s) => s.location).join(", ")}`,
      estimatedLift: Math.min(0.35, errorScreens.length * 0.1),
      rationale: "Perceived errors both block completion and durably damage trust across personas.",
    });
  }
  if (drains.length > 0) {
    out.push({
      change: `Clarify next steps / reduce ambiguity on: ${drains.slice(0, 2).map((d) => d.location).join(", ")}`,
      estimatedLift: 0.12,
      rationale: "These screens drain confidence even without hard errors — usually an information-scent or hierarchy problem.",
    });
  }
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  if (criticalCount > 0) {
    out.push({
      change: `Resolve the ${criticalCount} critical finding(s) surfaced during simulation`,
      estimatedLift: 0.2,
      rationale: "Critical findings correspond to abandonment or hard blockers in the observed runs.",
    });
  }
  return out.sort((a, b) => b.estimatedLift - a.estimatedLift);
}

function buildSummary(
  struggles: readonly StruggleForecast[],
  abandonment: readonly AbandonmentForecast[],
  sessionCount: number,
): string {
  if (struggles.length === 0 && abandonment.length === 0) {
    return `Across ${sessionCount} simulated session(s), no high-risk struggle points were forecast — the experience appears robust.`;
  }
  const topStruggle = struggles[0];
  const topAbandon = abandonment[0];
  const parts = [`Based on ${sessionCount} simulated session(s):`];
  if (topStruggle) {
    parts.push(
      `future users are most likely to struggle at "${topStruggle.location}" (${Math.round(topStruggle.struggleProbability * 100)}% risk).`,
    );
  }
  if (topAbandon && topAbandon.abandonmentRisk > 0) {
    parts.push(
      `The "${topAbandon.workflow}" workflow carries the highest abandonment risk (${Math.round(topAbandon.abandonmentRisk * 100)}%).`,
    );
  }
  return parts.join(" ");
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
