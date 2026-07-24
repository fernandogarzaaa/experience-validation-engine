/**
 * Human validation engine — compare EVE's simulated population against
 * anonymized human usability traces and score the realism of the simulation.
 *
 * The objective is continuous improvement: a low similarity score points to a
 * behaviour where EVE and real humans diverge, which is exactly where the model
 * should be tuned next.
 */

import type { PopulationStudy } from "../population/population.js";
import { quantile, pearson } from "../population/stats.js";
import type { HumanStudy, HumanTrace, CalibrationReport } from "./types.js";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round = (v: number, p = 3): number => Math.round(v * 10 ** p) / 10 ** p;

interface SideSummary {
  readonly completionRate: number;
  readonly abandonmentRate: number;
  readonly medianSteps: number;
  readonly transitions: Map<string, number>;
  readonly perScreenAbandon: Map<string, number>;
  readonly meanFrustration: number | null;
  readonly meanConfidence: number | null;
}

function transitionsFromPaths(paths: readonly (readonly string[])[]): Map<string, number> {
  const edges = new Map<string, number>();
  for (const path of paths) {
    for (let i = 0; i + 1 < path.length; i += 1) {
      if (path[i] === path[i + 1]) continue;
      const key = `${path[i]} ${path[i + 1]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges;
}

/** Cosine similarity of two frequency maps over the union of their keys. */
function cosine(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (keys.size === 0) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) {
    const x = a.get(k) ?? 0;
    const y = b.get(k) ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function summarizeHuman(study: HumanStudy): SideSummary {
  const traces = study.traces;
  const n = traces.length || 1;
  const abandoned = (t: HumanTrace): boolean => t.abandoned ?? !t.completed;
  const steps = traces.map((t) => t.steps ?? t.path.length);
  const perScreenAbandon = new Map<string, number>();
  for (const t of traces) {
    if (!abandoned(t)) continue;
    const screen = t.abandonedOn ?? t.path.at(-1);
    if (screen) perScreenAbandon.set(screen, (perScreenAbandon.get(screen) ?? 0) + 1 / n);
  }
  const frustrations = traces.map((t) => t.frustration).filter((v): v is number => typeof v === "number");
  const confidences = traces.map((t) => t.confidence).filter((v): v is number => typeof v === "number");
  return {
    completionRate: traces.filter((t) => t.completed).length / n,
    abandonmentRate: traces.filter(abandoned).length / n,
    medianSteps: quantile(steps, 0.5),
    transitions: transitionsFromPaths(traces.map((t) => t.path)),
    perScreenAbandon,
    meanFrustration: frustrations.length ? frustrations.reduce((s, v) => s + v, 0) / frustrations.length : null,
    meanConfidence: confidences.length ? confidences.reduce((s, v) => s + v, 0) / confidences.length : null,
  };
}

function summarizeEve(study: PopulationStudy): SideSummary {
  const ops = study.operators;
  const n = ops.length || 1;
  const perScreenAbandon = new Map<string, number>();
  for (const op of ops) {
    if (op.dropoffScreen) perScreenAbandon.set(op.dropoffScreen, (perScreenAbandon.get(op.dropoffScreen) ?? 0) + 1 / n);
  }
  return {
    completionRate: study.successRate,
    abandonmentRate: study.dropoffRate,
    medianSteps: quantile(ops.map((o) => o.steps), 0.5),
    transitions: transitionsFromPaths(ops.map((o) => o.path)),
    perScreenAbandon,
    meanFrustration: study.frustration.mean,
    meanConfidence: study.confidence.mean,
  };
}

/** Align two per-screen maps into paired vectors over their shared keys. */
function pairShared(a: Map<string, number>, b: Map<string, number>): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    xs.push(a.get(key) ?? 0);
    ys.push(b.get(key) ?? 0);
  }
  return { xs, ys };
}

/**
 * Calibrate EVE against a human study, producing similarity scores and
 * correlations. Both sides are summarized to comparable aggregates first.
 */
export function calibrate(human: HumanStudy, eve: PopulationStudy): CalibrationReport {
  const h = summarizeHuman(human);
  const e = summarizeEve(eve);
  const notes: string[] = [];

  const behaviorSimilarity = clamp01(
    1 - 0.5 * (Math.abs(e.completionRate - h.completionRate) + Math.abs(e.abandonmentRate - h.abandonmentRate)),
  );
  const navigationSimilarity = clamp01(cosine(e.transitions, h.transitions));

  const stepScale = Math.max(e.medianSteps, h.medianSteps, 1);
  const timingSimilarity = clamp01(1 - Math.abs(e.medianSteps - h.medianSteps) / stepScale);

  const { xs, ys } = pairShared(e.perScreenAbandon, h.perScreenAbandon);
  const frictionCorrelation = xs.length >= 2 ? pearson(xs, ys) : null;
  if (frictionCorrelation === null) notes.push("Too few shared screens to correlate friction location.");

  const frustrationAlignment =
    h.meanFrustration !== null && e.meanFrustration !== null
      ? clamp01(1 - Math.abs(e.meanFrustration - h.meanFrustration))
      : null;
  if (frustrationAlignment === null) notes.push("Human traces did not report frustration; alignment omitted.");
  const confidenceAlignment =
    h.meanConfidence !== null && e.meanConfidence !== null
      ? clamp01(1 - Math.abs(e.meanConfidence - h.meanConfidence))
      : null;
  if (confidenceAlignment === null) notes.push("Human traces did not report confidence; alignment omitted.");

  // Composite score: weighted mean of the available components (friction
  // correlation mapped from [-1,1] to [0,1]).
  const components: Array<{ value: number; weight: number }> = [
    { value: behaviorSimilarity, weight: 0.35 },
    { value: navigationSimilarity, weight: 0.3 },
    { value: timingSimilarity, weight: 0.2 },
  ];
  if (frictionCorrelation !== null) components.push({ value: (frictionCorrelation + 1) / 2, weight: 0.15 });
  if (frustrationAlignment !== null) components.push({ value: frustrationAlignment, weight: 0.1 });
  if (confidenceAlignment !== null) components.push({ value: confidenceAlignment, weight: 0.1 });
  const weightSum = components.reduce((s, c) => s + c.weight, 0);
  const similarityScore = Math.round((components.reduce((s, c) => s + c.value * c.weight, 0) / weightSum) * 100);

  return {
    task: human.task ?? null,
    humanSampleSize: human.traces.length,
    eveSampleSize: eve.size,
    behaviorSimilarity: round(behaviorSimilarity),
    navigationSimilarity: round(navigationSimilarity),
    timingSimilarity: round(timingSimilarity),
    frictionCorrelation: frictionCorrelation === null ? null : round(frictionCorrelation),
    frustrationAlignment: frustrationAlignment === null ? null : round(frustrationAlignment),
    confidenceAlignment: confidenceAlignment === null ? null : round(confidenceAlignment),
    similarityScore,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

/** Validate and normalize a parsed JSON object into a {@link HumanStudy}. */
export function importHumanStudy(raw: unknown): HumanStudy {
  if (typeof raw !== "object" || raw === null) throw new Error("Human study must be an object.");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.traces)) throw new Error("Human study must have a `traces` array.");
  const traces: HumanTrace[] = obj.traces.map((t, i) => {
    if (typeof t !== "object" || t === null) throw new Error(`Trace ${i} must be an object.`);
    const tr = t as Record<string, unknown>;
    if (typeof tr.completed !== "boolean") throw new Error(`Trace ${i} needs a boolean \`completed\`.`);
    if (!Array.isArray(tr.path) || !tr.path.every((s) => typeof s === "string")) {
      throw new Error(`Trace ${i} needs a string[] \`path\`.`);
    }
    return {
      completed: tr.completed,
      path: tr.path as string[],
      ...(typeof tr.abandoned === "boolean" ? { abandoned: tr.abandoned } : {}),
      ...(typeof tr.steps === "number" ? { steps: tr.steps } : {}),
      ...(typeof tr.durationMs === "number" ? { durationMs: tr.durationMs } : {}),
      ...(typeof tr.frustration === "number" ? { frustration: tr.frustration } : {}),
      ...(typeof tr.confidence === "number" ? { confidence: tr.confidence } : {}),
      ...(typeof tr.abandonedOn === "string" ? { abandonedOn: tr.abandonedOn } : {}),
    };
  });
  return { ...(typeof obj.task === "string" ? { task: obj.task } : {}), traces };
}
