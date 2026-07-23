import type { Percept, PredictionOutcome } from "../core/types.js";
import { clamp01 } from "../core/random.js";

/**
 * Trust model.
 *
 * Humans build trust in a system gradually and lose it abruptly (trust
 * asymmetry; Slovic 1993). Trust in automation decomposes into
 * predictability, dependability and faith (Lee & See 2004; Muir 1987). EVE
 * tracks component trust dimensions that evolve from perceived events and
 * roll up into an overall trust level that feeds the emotional state and,
 * through it, decisions (low trust → verification behavior).
 *
 * Components (0..1):
 * - predictability: did outcomes match predictions?
 * - consistency: does the UI behave the same way across encounters?
 * - errorRecovery: when things went wrong, was there a way forward?
 * - feedbackQuality: did the system acknowledge actions?
 * - securityPerception: do visible cues signal a safe, credible system?
 *
 * Update rates are asymmetric: negative evidence moves trust faster than
 * positive evidence.
 */

export interface TrustComponents {
  predictability: number;
  consistency: number;
  errorRecovery: number;
  feedbackQuality: number;
  securityPerception: number;
}

export interface TrustSample {
  step: number;
  overall: number;
  components: TrustComponents;
}

const GAIN = 0.06; // trust builds slowly
const LOSS = 0.16; // trust falls quickly (asymmetry)

export class TrustModel {
  private readonly components: TrustComponents;
  private readonly history: TrustSample[] = [];

  constructor(initial = 0.6) {
    this.components = {
      predictability: initial,
      consistency: initial,
      errorRecovery: initial,
      feedbackQuality: initial,
      securityPerception: initial,
    };
  }

  private nudge(key: keyof TrustComponents, delta: number): void {
    const rate = delta >= 0 ? GAIN : LOSS;
    this.components[key] = clamp01(this.components[key] + delta * rate);
  }

  /**
   * Update trust from one interaction outcome and the resulting screen.
   */
  update(outcome: PredictionOutcome, perceivedError: boolean, gaveFeedback: boolean): void {
    // Predictability: surprise erodes it, confirmation builds it.
    this.nudge("predictability", outcome.surprise > 0.5 ? -outcome.surprise : 0.5);

    // Feedback: a visible response to an action that expected change.
    if (outcome.prediction.expectsChange) {
      this.nudge("feedbackQuality", outcome.screenChanged || gaveFeedback ? 0.5 : -1);
    }

    // Error recovery: an error damages trust; escaping it later restores some.
    if (perceivedError) this.nudge("errorRecovery", -1);
    else if (outcome.screenChanged) this.nudge("errorRecovery", 0.2);

    // Latency beyond a couple seconds dents dependability-as-predictability.
    if (outcome.perceivedLatencyMs > 3000) this.nudge("predictability", -0.4);
  }

  /** Consistency signal from revisiting a screen that looked the same. */
  reinforceConsistency(sameAsRemembered: boolean): void {
    this.nudge("consistency", sameAsRemembered ? 0.5 : -0.8);
  }

  /**
   * Security perception from visible credibility cues on a screen: HTTPS in
   * the URL bar, absence of scary permission asks, presence of trust markers.
   * Purely perceptual — no network inspection.
   */
  observeSecurityCues(percept: Percept): void {
    const url = percept.url.toLowerCase();
    const secure = url.startsWith("https://") || url.startsWith("mock://");
    if (!secure && (url.startsWith("http://"))) this.nudge("securityPerception", -0.5);
    const text = percept.elements.map((e) => e.text.toLowerCase()).join(" ");
    if (/\b(secure|encrypted|privacy|verified|ssl|protected)\b/.test(text)) {
      this.nudge("securityPerception", 0.3);
    }
    if (/\b(enter your (card|ssn|social security|password)|we never share)\b/.test(text)) {
      // Sensitive asks without reassurance slightly lower perceived security.
      this.nudge("securityPerception", /never share|secure/.test(text) ? 0.2 : -0.3);
    }
  }

  overall(): number {
    const c = this.components;
    // Predictability and error recovery weigh most (Lee & See: performance
    // and process dominate purpose in early trust).
    return clamp01(
      c.predictability * 0.3 +
        c.consistency * 0.2 +
        c.errorRecovery * 0.22 +
        c.feedbackQuality * 0.18 +
        c.securityPerception * 0.1,
    );
  }

  snapshot(): TrustComponents {
    return { ...this.components };
  }

  record(step: number): void {
    this.history.push({ step, overall: this.overall(), components: this.snapshot() });
  }

  timeline(): readonly TrustSample[] {
    return this.history;
  }
}
