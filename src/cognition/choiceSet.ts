import type { ChoiceCandidate, ChoiceSet } from "../core/types.js";
import { describeAction } from "../core/types.js";
import type { SalienceScore } from "./salience.js";
import type { UtilityScore } from "./utility.js";

/**
 * Choice-set recording (Phase 3 calibration substrate).
 *
 * What alternatives were available at the moment of decision — recorded,
 * never invented. The evidence ladder is strict:
 *
 * - `heuristic-ordered`: cascade order + eligibility + salience scores.
 *   NO probabilities (the cascade never computes any).
 * - `probabilistic`: utility scores + real softmax probabilities.
 * - `deterministic-single`: exactly one eligible candidate.
 *
 * Builders are pure mappings over data the policy already computed: they
 * consume no RNG and change no decision. Branches that select without
 * scoring (dialogs, loading, abandonment) record nothing — absence explicit.
 */

/** Heuristic cascade choice record from the considered salience slice. */
export function heuristicChoiceSet(
  considered: readonly SalienceScore[],
  chosenIndex: number,
  selectionRule: string,
  refused: readonly { score: SalienceScore; reason: string }[] = [],
): ChoiceSet {
  const candidates: ChoiceCandidate[] = [
    ...considered.map((s, rank) => ({
      action: { kind: "click" as const, target: s.element },
      label: describeAction({ kind: "click", target: s.element }),
      eligible: true,
      rank,
      score: s.total,
    })),
    ...refused.map(({ score, reason }) => ineligibleCandidate(score, reason)),
  ];
  if (candidates.length === 1) {
    return { kind: "deterministic-single", candidates, selectedIndex: 0, selectionRule };
  }
  return { kind: "heuristic-ordered", candidates, selectedIndex: chosenIndex, selectionRule };
}

/** Utility-policy choice record with the true softmax distribution. */
export function utilityChoiceSet(
  positive: readonly UtilityScore[],
  probabilities: readonly number[],
  temperature: number,
  chosenIndex: number,
): ChoiceSet {
  const candidates: ChoiceCandidate[] = positive.map((u, i) => ({
    action: { kind: "click" as const, target: u.element },
    label: describeAction({ kind: "click", target: u.element }),
    eligible: true,
    rank: i,
    score: u.utility,
    probability: probabilities[i],
  }));
  if (candidates.length === 1) {
    return { kind: "deterministic-single", candidates, selectedIndex: 0 };
  }
  return { kind: "probabilistic", candidates, selectedIndex: chosenIndex, temperature };
}

/**
 * Ineligible candidates excluded before scoring (e.g. risk-refused
 * controls). Recorded so calibration knows what was available-but-barred,
 * distinct from never-considered.
 */
export function ineligibleCandidate(score: SalienceScore, reason: string): ChoiceCandidate {
  return {
    action: { kind: "click" as const, target: score.element },
    label: describeAction({ kind: "click", target: score.element }),
    eligible: false,
    ineligibilityReason: reason,
    score: score.total,
  };
}
