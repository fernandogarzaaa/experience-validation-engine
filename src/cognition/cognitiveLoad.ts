import { clamp01 } from "../core/random.js";
import type { Percept } from "../core/types.js";
import type { Persona } from "../personas/persona.js";
import { workingMemoryCapacity } from "../personas/persona.js";

/**
 * Cognitive load estimation.
 *
 * Estimates the *extraneous* cognitive load an interface imposes — the part
 * of load the design owns, as opposed to intrinsic task difficulty
 * (Cognitive Load Theory; Sweller 1988). The decomposition follows NASA-TLX
 * style multi-component workload (Hart & Staveland 1988) and visual-clutter
 * measures (Rosenholtz et al. 2007).
 *
 * Components (each 0..1, "load" so higher is worse):
 * - workingMemoryLoad: interactive choices vs. the operator's WM capacity
 *   (Hick–Hyman: choice load grows with log2 of options).
 * - informationLoad: reading burden on the screen.
 * - decisionLoad: competing plausible actions.
 * - visualClutter: element density + disorganization.
 * - taskSwitchLoad: how far this screen is from the previous (context switch).
 */

export interface CognitiveLoadBreakdown {
  workingMemoryLoad: number;
  informationLoad: number;
  decisionLoad: number;
  visualClutter: number;
  taskSwitchLoad: number;
  /** Weighted composite 0..100 — the Cognitive Load Index. */
  index: number;
}

export function estimateCognitiveLoad(
  percept: Percept,
  previousPercept: Percept | null,
  persona: Persona,
): CognitiveLoadBreakdown {
  const interactive = percept.elements.filter((e) => e.interactive && !e.disabled);
  const wmCapacity = workingMemoryCapacity(persona);

  // Hick–Hyman: perceived choice complexity ~ log2(n+1); load relative to WM.
  const choiceComplexity = Math.log2(interactive.length + 1);
  const workingMemoryLoad = clamp01(choiceComplexity / (wmCapacity + 2));

  let words = 0;
  for (const el of percept.elements) words += el.text.split(/\s+/).filter(Boolean).length;
  const informationLoad = clamp01(words / 500);

  // Decision load: distinct plausible actions of similar visual weight.
  const buttons = interactive.filter((e) => e.role === "button" || e.role === "link");
  const decisionLoad = clamp01(buttons.length / 15);

  // Visual clutter: element density + variety of sizes (disorganization).
  const viewportArea = percept.viewport.width * percept.viewport.height || 1;
  const density = clamp01((percept.elements.length / (viewportArea / 100000)) * 0.1);
  const sizes = percept.elements
    .filter((e) => e.box.width > 0 && e.box.height > 0)
    .map((e) => e.box.width * e.box.height);
  const sizeVariety = sizes.length > 1 ? clamp01(coefficientOfVariation(sizes) / 3) : 0;
  const visualClutter = clamp01(density * 0.6 + sizeVariety * 0.4);

  // Task switch: token dissimilarity from the previous screen.
  let taskSwitchLoad = 0;
  if (previousPercept) {
    taskSwitchLoad = clamp01(tokenDissimilarity(previousPercept, percept));
  }

  // TLX-style weighted composite. WM and decision dominate — they are the
  // parts most predictive of user error and abandonment.
  const composite =
    workingMemoryLoad * 0.28 +
    decisionLoad * 0.24 +
    informationLoad * 0.2 +
    visualClutter * 0.18 +
    taskSwitchLoad * 0.1;
  // Persona modulation: high tech literacy lowers effective extraneous load.
  const literacyRelief = 1 - persona.traits.techLiteracy * 0.25;

  return {
    workingMemoryLoad: round(workingMemoryLoad),
    informationLoad: round(informationLoad),
    decisionLoad: round(decisionLoad),
    visualClutter: round(visualClutter),
    taskSwitchLoad: round(taskSwitchLoad),
    index: Math.round(clamp01(composite * literacyRelief) * 100),
  };
}

/** Running decision-fatigue accumulator: each hard choice depletes capacity. */
export class DecisionFatigue {
  private accumulated = 0;

  /** Register a decision; harder decisions deplete more (ego depletion). */
  register(loadIndex: number): void {
    this.accumulated += (loadIndex / 100) * 0.05;
  }

  /** 0..1 fatigue from cumulative decision-making this session. */
  level(): number {
    return clamp01(this.accumulated);
  }
}

function coefficientOfVariation(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function tokenDissimilarity(a: Percept, b: Percept): number {
  const tok = (p: Percept) =>
    new Set(
      p.elements
        .flatMap((e) => e.text.toLowerCase().split(/[^a-z0-9]+/))
        .filter((t) => t.length > 2),
    );
  const sa = tok(a);
  const sb = tok(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

function round(v: number): number {
  return Number(v.toFixed(3));
}
