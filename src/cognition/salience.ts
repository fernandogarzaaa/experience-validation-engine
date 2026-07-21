import type { Percept, VisibleElement } from "../core/types.js";
import { tokenize } from "./mentalModel.js";
import { screenSignature } from "../memory/memory.js";
import type { CognitiveContext } from "./cognition.js";

/**
 * Salience: which visible element pulls the operator's attention.
 *
 * Humans don't evaluate every control rationally — attention is drawn by a
 * blend of goal relevance, visual prominence, novelty and habit, and
 * repelled by perceived risk. The weights below encode that blend, with
 * persona traits shifting the balance (a curious explorer weighs novelty
 * heavily; an anxious user weighs risk heavily).
 */

export interface SalienceScore {
  readonly element: VisibleElement;
  readonly total: number;
  readonly goalRelevance: number;
  readonly prominence: number;
  readonly novelty: number;
  readonly risk: number;
}

const DESTRUCTIVE_RE = /\b(delete|remove|discard|reset|erase|clear all|deactivate|cancel account|unsubscribe)\b/i;
const COMMITTING_RE = /\b(submit|pay|purchase|buy|confirm|send|publish|order)\b/i;

export function riskOf(element: VisibleElement): number {
  if (DESTRUCTIVE_RE.test(element.text)) return 1;
  if (COMMITTING_RE.test(element.text)) return 0.55;
  return 0;
}

/** Visual prominence: size, position, being a "real" control. */
export function prominenceOf(element: VisibleElement, percept: Percept): number {
  const area = element.box.width * element.box.height;
  const viewportArea = percept.viewport.width * percept.viewport.height || 1;
  const sizeScore = Math.min(1, (area / viewportArea) * 40); // ~2.5% of screen = max
  const aboveFold = element.box.y < percept.viewport.height ? 1 : 0.3;
  const centrality =
    1 -
    Math.min(
      1,
      Math.abs(element.box.x + element.box.width / 2 - percept.viewport.width / 2) /
        (percept.viewport.width || 1),
    );
  const roleBoost =
    element.role === "button" ? 0.3 : element.role === "link" ? 0.15 : element.role === "textbox" ? 0.2 : 0;
  return Math.min(1, sizeScore * 0.4 + aboveFold * 0.3 + centrality * 0.15 + roleBoost);
}

export function goalRelevanceOf(element: VisibleElement, goalKeywords: readonly string[]): number {
  if (goalKeywords.length === 0) return 0;
  const labelTokens = new Set(tokenize(element.text));
  if (labelTokens.size === 0) return 0;
  let hits = 0;
  for (const kw of goalKeywords) {
    if (labelTokens.has(kw)) hits += 1;
    else {
      for (const token of labelTokens) {
        // Prefix overlap is weak evidence ("log" vs "login") — worth far
        // less than an exact hit, so exact goal words dominate the choice.
        if (token.length >= 4 && kw.length >= 4 && (token.startsWith(kw) || kw.startsWith(token))) {
          hits += 0.25;
          break;
        }
      }
    }
  }
  return Math.min(1, hits / Math.max(1, Math.min(goalKeywords.length, 3)));
}

/**
 * Score every candidate interactive element on the current screen.
 */
export function scoreAffordances(
  ctx: CognitiveContext,
  goalKeywords: readonly string[],
): SalienceScore[] {
  const { percept, persona, memory, emotion } = ctx;
  const sig = screenSignature(percept);
  const node = memory.knownScreens().find((s) => s.signature === sig);
  const scores: SalienceScore[] = [];

  for (const element of percept.elements) {
    if (!element.interactive || element.disabled) continue;
    if (element.box.width < 2 || element.box.height < 2) continue;

    const goalRelevance = goalRelevanceOf(element, goalKeywords);
    const prominence = prominenceOf(element, percept);
    const tried = node?.triedAffordances.has(element.text.trim().toLowerCase()) ?? false;
    const novelty = tried ? 0 : 1;
    const risk = riskOf(element);

    const t = persona.traits;
    // Risk aversion grows when confidence is low; explorers discount it.
    const riskPenalty = risk * (1.3 - t.riskTolerance) * (1.2 - emotion.confidence);
    const total =
      goalRelevance * 2.2 +
      prominence * (0.6 + (1 - t.thoroughness) * 0.4) + // skimmers chase shiny things
      novelty * (0.3 + t.curiosity * 0.9 + t.experimentation * 0.4) +
      -riskPenalty +
      // Familiar, previously-successful paths appeal when frustrated.
      (tried && emotion.frustration > 0.5 ? 0.3 : 0);

    scores.push({ element, total, goalRelevance, prominence, novelty, risk });
  }

  return scores.sort((a, b) => b.total - a.total);
}

/** Reading load of the current screen, 0..1 (drives cognitive effort). */
export function readingLoad(percept: Percept): number {
  let words = 0;
  for (const el of percept.elements) words += el.text.split(/\s+/).filter(Boolean).length;
  return Math.min(1, words / 600);
}

/** Choice overload: too many competing interactive elements, 0..1. */
export function choiceLoad(percept: Percept): number {
  const interactive = percept.elements.filter((e) => e.interactive && !e.disabled).length;
  return Math.min(1, interactive / 40);
}
