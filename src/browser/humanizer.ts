import type { Point, VisibleElement } from "../core/types.js";
import type { Rng } from "../core/random.js";
import {
  clickScatterPx,
  motorActionMs,
  typingIntervalMs,
  type Persona,
} from "../personas/persona.js";

/**
 * Humanizer: turns an abstract intent ("click that button") into the noisy,
 * time-consuming gesture a real person performs.
 *
 * - Click points scatter around the target center (Gaussian, persona-scaled)
 *   and can genuinely miss small targets — producing the same misclick
 *   behavior real users exhibit on cramped UI.
 * - Every gesture consumes wall-clock-equivalent time derived from persona
 *   motor speed (used both for pacing real browsers and for the simulated
 *   clock in reports).
 * - Typing has per-character cadence and occasional corrected typos.
 */

export interface Gesture {
  readonly point: Point;
  /** True when the scatter landed outside the intended target. */
  readonly missed: boolean;
  readonly durationMs: number;
}

export function planClick(
  target: VisibleElement,
  persona: Persona,
  rng: Rng,
): Gesture {
  const cx = target.box.x + target.box.width / 2;
  const cy = target.box.y + target.box.height / 2;
  const scatter = clickScatterPx(persona);
  const x = rng.gaussian(cx, scatter + target.box.width * 0.08);
  const y = rng.gaussian(cy, scatter + target.box.height * 0.08);
  const missed =
    x < target.box.x ||
    x > target.box.x + target.box.width ||
    y < target.box.y ||
    y > target.box.y + target.box.height;
  // A miss on a tiny target: humans notice and correct, which costs time —
  // the actuator re-aims at the center, but we keep `missed` as a signal.
  const point: Point = missed
    ? { x: cx, y: cy }
    : { x, y };
  const durationMs = Math.max(
    120,
    rng.gaussian(motorActionMs(persona), motorActionMs(persona) * 0.2),
  ) + (missed ? motorActionMs(persona) * 0.6 : 0);
  return { point: { x: Math.round(point.x), y: Math.round(point.y) }, missed, durationMs };
}

export interface TypingPlan {
  /** The keystroke sequence, including typo + backspace corrections. */
  readonly keystrokes: readonly string[];
  readonly perCharIntervalMs: number;
  readonly totalMs: number;
  readonly typoCount: number;
}

const NEIGHBOR_KEYS: Record<string, string> = {
  a: "s", s: "a", d: "f", f: "g", g: "h", h: "j", j: "k", k: "l",
  q: "w", w: "e", e: "r", r: "t", t: "y", y: "u", u: "i", i: "o", o: "p",
  z: "x", x: "c", c: "v", v: "b", b: "n", n: "m", m: "n",
};

export function planTyping(text: string, persona: Persona, rng: Rng): TypingPlan {
  const interval = typingIntervalMs(persona);
  // Typo probability scales with speed and inverse accuracy.
  const typoP = 0.02 + (1 - persona.traits.clickAccuracy) * 0.05;
  const keystrokes: string[] = [];
  let typoCount = 0;
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (NEIGHBOR_KEYS[lower] && rng.chance(typoP)) {
      keystrokes.push(NEIGHBOR_KEYS[lower]!, "\b", ch);
      typoCount += 1;
    } else {
      keystrokes.push(ch);
    }
  }
  return {
    keystrokes,
    perCharIntervalMs: interval,
    totalMs: keystrokes.length * interval,
    typoCount,
  };
}

/** Hesitation pause before a consequential action, in ms. */
export function hesitationMs(risk: number, persona: Persona, rng: Rng): number {
  if (risk <= 0.1) return 0;
  const base = risk * (1.5 - persona.traits.riskTolerance) * 1800;
  return Math.max(0, rng.gaussian(base, base * 0.3));
}
