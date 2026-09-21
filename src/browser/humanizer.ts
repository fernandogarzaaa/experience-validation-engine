import type { Rng } from "../core/random.js";
import { clamp01 } from "../core/random.js";
import type { Point, Viewport, VisibleElement } from "../core/types.js";
import {
  clickScatterPx,
  motorActionMs,
  type Persona,
  typingIntervalMs,
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
  /**
   * What the miss MEANT (P1.1):
   * - "hit": landed on target.
   * - "corrected": mis-aim noticed and corrected (re-aimed at center) with
   *   a time cost — the environment sees the intended target.
   * - "stray": true wrong-target interaction — `point` is the actual
   *   scattered landing and the environment receives it.
   */
  readonly disposition: "hit" | "corrected" | "stray";
  readonly durationMs: number;
}

/**
 * Miss-disposition policy (reviewer decision 5).
 *
 * Hierarchy (most → least general): global physical interaction model →
 * device/surface parameters → persona motor parameters. The threshold is
 * therefore a property of the PLAN CALL (device-aware defaults), not of the
 * persona — a 12px miss means something different on a touch phone than
 * under a desktop mouse, and it is normalized against the live scatter
 * (which already folds in persona accuracy, target geometry and device).
 *
 * HEURISTIC PARAMETER — provisional deterministic rule, explicitly
 * uncalibrated. Do not fit per-persona values until human trajectory data
 * justifies them.
 */
export interface MisclickPolicy {
  /** Misses within this px distance (near-edge slips) are corrected. */
  readonly nearMissThresholdPx: number;
  /** ...or within scatter × this multiple, whichever is larger. */
  readonly scatterMultiple: number;
}

export const CLICK_MISCLICK_POLICY: MisclickPolicy = {
  nearMissThresholdPx: 10,
  scatterMultiple: 1.5,
};

export const TAP_MISCLICK_POLICY: MisclickPolicy = {
  nearMissThresholdPx: 12,
  scatterMultiple: 1.5,
};

/** Near-edge slip (corrected) vs far stray, without consuming extra RNG. */
function missDisposition(
  missDistancePx: number,
  scatter: number,
  policy: MisclickPolicy,
): Gesture["disposition"] {
  if (missDistancePx <= 0) return "hit";
  return missDistancePx <= Math.max(policy.nearMissThresholdPx, scatter * policy.scatterMultiple)
    ? "corrected"
    : "stray";
}

export function planClick(
  target: VisibleElement,
  persona: Persona,
  rng: Rng,
  policy: MisclickPolicy = CLICK_MISCLICK_POLICY,
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
  // P1.1: a miss is either corrected (mis-aim + time cost, environment sees
  // the target) or a true stray (the scattered point actually lands and the
  // environment receives the wrong interaction). Decided WITHOUT consuming
  // extra RNG — by how far outside the target the scatter landed — so the
  // random stream (and hence seeded trajectories) is unchanged.
  const outsideX = Math.max(target.box.x - x, 0, x - (target.box.x + target.box.width));
  const outsideY = Math.max(target.box.y - y, 0, y - (target.box.y + target.box.height));
  const missDistancePx = Math.hypot(outsideX, outsideY);
  let disposition: Gesture["disposition"] = "hit";
  let point: Point = { x, y };
  if (missed) {
    disposition = missDisposition(missDistancePx, scatter, policy);
    if (disposition === "corrected") point = { x: cx, y: cy };
  }
  const durationMs =
    Math.max(120, rng.gaussian(motorActionMs(persona), motorActionMs(persona) * 0.2)) +
    (missed ? motorActionMs(persona) * 0.6 : 0);
  return {
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    missed,
    disposition,
    durationMs,
  };
}

/**
 * Touch equivalent of {@link planClick}: a tap.
 *
 * Materially noisier than a mouse click — the touch point is the centroid of
 * a fingertip contact patch, not a single pixel, and there is no cursor to
 * confirm aim before the tap lands. Scatter also grows with thumb-reach cost:
 * targets far from where a one-handed thumb rests (top corners) are struck
 * less precisely than targets near the bottom-center, where the thumb
 * naturally lands. This models one-handed use, the conservative case for a
 * mobile UX audit — two-handed use would only improve on it.
 */
const TOUCH_SCATTER_MULTIPLIER = 2.2;
/** Approximate radius of a fingertip contact patch, in CSS px. */
const CONTACT_PATCH_RADIUS_PX = 5;

export function planTap(
  target: VisibleElement,
  persona: Persona,
  rng: Rng,
  viewport: Viewport,
  policy: MisclickPolicy = TAP_MISCLICK_POLICY,
): Gesture {
  const cx = target.box.x + target.box.width / 2;
  const cy = target.box.y + target.box.height / 2;
  const reach = thumbReachCost(cx, cy, viewport);
  const scatter =
    clickScatterPx(persona) * TOUCH_SCATTER_MULTIPLIER * (1 + reach) + CONTACT_PATCH_RADIUS_PX;
  const x = rng.gaussian(cx, scatter + target.box.width * 0.08);
  const y = rng.gaussian(cy, scatter + target.box.height * 0.08);
  const missed =
    x < target.box.x ||
    x > target.box.x + target.box.width ||
    y < target.box.y ||
    y > target.box.y + target.box.height;
  let disposition: Gesture["disposition"] = "hit";
  let point: Point = { x, y };
  if (missed) {
    // Same RNG-neutral rule as planClick with the touch policy:
    // reach-inflated scatter makes far strays likelier one-handed.
    const tOutsideX = Math.max(target.box.x - x, 0, x - (target.box.x + target.box.width));
    const tOutsideY = Math.max(target.box.y - y, 0, y - (target.box.y + target.box.height));
    disposition = missDisposition(Math.hypot(tOutsideX, tOutsideY), scatter, policy);
    if (disposition === "corrected") point = { x: cx, y: cy };
  }
  const baseDuration = motorActionMs(persona) * (1 + reach * 0.5);
  const durationMs =
    Math.max(120, rng.gaussian(baseDuration, baseDuration * 0.2)) +
    (missed ? motorActionMs(persona) * 0.6 : 0);
  return {
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    missed,
    disposition,
    durationMs,
  };
}

/**
 * Cost, 0 (cheap) to ~1 (expensive), of a one-handed thumb reaching (x, y).
 * The thumb is anchored near the bottom-center of the viewport, where it
 * naturally rests; vertical distance dominates the cost (the far edge of a
 * tall phone is the hardest stretch), horizontal distance from center adds a
 * smaller penalty.
 */
function thumbReachCost(x: number, y: number, viewport: Viewport): number {
  const dx = (x - viewport.width / 2) / (viewport.width / 2 || 1);
  const dy = (viewport.height - y) / (viewport.height || 1);
  return clamp01(Math.abs(dy) * 0.8 + Math.abs(dx) * 0.35);
}

export interface TypingPlan {
  /** The keystroke sequence, including typo + backspace corrections. */
  readonly keystrokes: readonly string[];
  readonly perCharIntervalMs: number;
  readonly totalMs: number;
  readonly typoCount: number;
}

const NEIGHBOR_KEYS: Record<string, string> = {
  a: "s",
  s: "a",
  d: "f",
  f: "g",
  g: "h",
  h: "j",
  j: "k",
  k: "l",
  q: "w",
  w: "e",
  e: "r",
  r: "t",
  t: "y",
  y: "u",
  u: "i",
  i: "o",
  o: "p",
  z: "x",
  x: "c",
  c: "v",
  v: "b",
  b: "n",
  n: "m",
  m: "n",
};

export function planTyping(text: string, persona: Persona, rng: Rng): TypingPlan {
  const interval = typingIntervalMs(persona);
  // P1.2: typo probability comes from TYPING accuracy, never pointer precision.
  const typingAccuracy = persona.traits.typingAccuracy ?? persona.traits.clickAccuracy;
  const typoP = 0.02 + (1 - typingAccuracy) * 0.05;
  return buildTypingPlan(text, interval, typoP, rng);
}

/** Multiplier on typed-character cadence when typing on a soft keyboard. */
const SOFT_KEYBOARD_SLOWDOWN = 1.4;
/** Multiplier on typo probability when typing on a soft keyboard. */
const SOFT_KEYBOARD_TYPO_MULTIPLIER = 1.8;

/**
 * Touch equivalent of {@link planTyping}: typing on a soft keyboard.
 *
 * Slower per-character cadence (no tactile key edges to feel for) and a
 * higher typo rate (fingertip-sized keys, no physical travel to confirm a
 * keypress registered).
 */
export function planSoftKeyType(text: string, persona: Persona, rng: Rng): TypingPlan {
  const interval = typingIntervalMs(persona) * SOFT_KEYBOARD_SLOWDOWN;
  const typingAccuracy = persona.traits.typingAccuracy ?? persona.traits.clickAccuracy;
  const typoP = (0.02 + (1 - typingAccuracy) * 0.05) * SOFT_KEYBOARD_TYPO_MULTIPLIER;
  return buildTypingPlan(text, interval, typoP, rng);
}

function buildTypingPlan(text: string, interval: number, typoP: number, rng: Rng): TypingPlan {
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

export interface SwipeSegment {
  /** Scroll delta for this segment, in CSS px (same sign convention as `scrollBy`). */
  readonly deltaY: number;
  readonly durationMs: number;
}

export interface SwipePlan {
  /** A flick followed by decaying momentum segments, never one atomic jump. */
  readonly segments: readonly SwipeSegment[];
  readonly totalMs: number;
}

/** Fraction of the previous segment's distance each successive segment carries. */
const SWIPE_MOMENTUM_DECAY = 0.55;
const MIN_SWIPE_SEGMENTS = 3;
const MAX_SWIPE_SEGMENTS = 6;

/**
 * Plans a swipe-to-scroll gesture as a flick plus decaying momentum, the way
 * a touch scroll actually feels — never the single atomic jump a mouse wheel
 * event is. The adapter still only ever receives plain `scrollBy(deltaY)`
 * calls, one per segment; composing the momentum curve is cognition's job,
 * not the adapter's.
 */
export function planSwipe(totalDeltaY: number, persona: Persona, rng: Rng): SwipePlan {
  if (totalDeltaY === 0) return { segments: [], totalMs: 0 };
  const segmentCount = rng.int(MIN_SWIPE_SEGMENTS, MAX_SWIPE_SEGMENTS);
  const weights: number[] = [];
  let weight = 1;
  for (let i = 0; i < segmentCount; i++) {
    weights.push(weight);
    weight *= SWIPE_MOMENTUM_DECAY;
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const perSegmentMs = Math.max(40, 260 - persona.traits.motorSpeed * 160);
  const segments: SwipeSegment[] = weights.map((w, i) => ({
    deltaY: Math.round((totalDeltaY * w) / weightSum),
    // Deceleration: each successive momentum segment takes a little longer.
    durationMs: Math.round(perSegmentMs * (1 + i * 0.15)),
  }));
  // Integer rounding can leave a residual; fold it into the last segment so
  // the gesture lands exactly where cognition intended.
  const distributed = segments.reduce((sum, s) => sum + s.deltaY, 0);
  const residual = totalDeltaY - distributed;
  if (residual !== 0) {
    const last = segments[segments.length - 1]!;
    segments[segments.length - 1] = { ...last, deltaY: last.deltaY + residual };
  }
  return { segments, totalMs: segments.reduce((sum, s) => sum + s.durationMs, 0) };
}

/** Hesitation pause before a consequential action, in ms. */
export function hesitationMs(risk: number, persona: Persona, rng: Rng): number {
  if (risk <= 0.1) return 0;
  const base = risk * (1.5 - persona.traits.riskTolerance) * 1800;
  return Math.max(0, rng.gaussian(base, base * 0.3));
}
