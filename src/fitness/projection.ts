/**
 * Projecting a CP/1 {@link Mutation} onto a simulated operator.
 *
 * ## What this module claims, and what it does not
 *
 * ADAM proposes changes to a genome: preferences, policies, goals, values,
 * capabilities, skills. EVE cannot measure a genome — it measures how an
 * operator fares against software. So a mutation is measurable here exactly
 * when it changes how the organism *operates*, and this module is the declared,
 * auditable mapping that says which mutations those are.
 *
 * When a mutation has no operational meaning — amending a goal, reconciling a
 * belief — this module returns `null` and the caller reports `needs_review`
 * with that reason. It does **not** invent a trait delta so that a number can
 * be produced. Fabricating a score for an unmeasurable change is precisely the
 * failure the CP/1 work exists to remove: the arrangement it replaced scored
 * every proposal by calling a closure the proposer supplied, and called the
 * result evidence.
 *
 * A mutation EVE declines to score is not thereby blocked. It is escalated:
 * ADAM's governance still decides, now knowing that simulation had nothing to
 * say rather than believing it had approved.
 *
 * ## Extending the mapping
 *
 * {@link TRAIT_PROJECTIONS} and {@link POLICY_KEYWORDS} are the extension
 * points. Both are data, both are exhaustively tested, and both are deliberate
 * about magnitude: a projection's effect size is fixed by the table, never
 * scaled by the mutation's own `confidence_bp`. Letting a proposal amplify its
 * own measured effect by asserting confidence in itself would reintroduce
 * self-reported evidence through the back door.
 */

import type { PersonaTraits } from "../personas/persona.js";
import type { Mutation } from "../protocol/types.js";

/** A change to one operator trait, in trait units. */
export interface TraitDelta {
  readonly trait: keyof PersonaTraits;
  /** Added to the baseline trait value, then clamped to the trait's range. */
  readonly amount: number;
}

export interface Projection {
  readonly deltas: readonly TraitDelta[];
  /** Human-readable account of why these deltas, for the FitnessResult reason. */
  readonly explanation: string;
}

/**
 * Genome preference keys with a defensible operational meaning, and the
 * operator trait each drives.
 *
 * Every entry answers "if the organism held this preference more strongly,
 * what would an observer see it do differently?". A preference that cannot
 * answer that question does not belong here.
 */
export const TRAIT_PROJECTIONS: Readonly<Record<string, readonly (keyof PersonaTraits)[]>> = {
  // Reads more of what is on screen before acting.
  thoroughness: ["thoroughness"],
  // Tolerates more friction before abandoning.
  patience: ["patience"],
  // More willing to click controls with unknown or destructive-looking effect.
  risk_tolerance: ["riskTolerance"],
  // Seeks out unvisited parts of the product, and tries unknown actions.
  exploration: ["curiosity", "experimentation"],
  // Sticks to the current subgoal instead of wandering.
  focus: ["attentionSpan"],
  // Updates its model of the product faster from each outcome.
  adaptivity: ["learningRate"],
  // Recovers composure after an error instead of spiralling.
  resilience: ["resilience"],
  // Prefers keyboard paths over pointing.
  keyboard_first: ["keyboardPreference"],
};

/**
 * Policy phrasings with an operational meaning, and their trait effect.
 *
 * Matched as substrings against a lowercased policy, longest first, so
 * "verify before acting" matches `verify` rather than needing an exact form.
 * Only the first match applies: a policy is one instruction, and summing
 * overlapping keyword hits would let verbose phrasing inflate an effect.
 */
export const POLICY_KEYWORDS: Readonly<Record<string, TraitDelta>> = {
  verify: { trait: "thoroughness", amount: 0.15 },
  "double-check": { trait: "thoroughness", amount: 0.15 },
  "read carefully": { trait: "thoroughness", amount: 0.12 },
  "ask before": { trait: "riskTolerance", amount: -0.15 },
  "never delete": { trait: "riskTolerance", amount: -0.2 },
  cautious: { trait: "riskTolerance", amount: -0.15 },
  "move fast": { trait: "patience", amount: -0.15 },
  explore: { trait: "curiosity", amount: 0.15 },
  "prefer keyboard": { trait: "keyboardPreference", amount: 0.25 },
  persist: { trait: "patience", amount: 0.15 },
};

/** Fixed effect size for a preference amendment, in trait units. */
const PREFERENCE_MAGNITUDE = 0.2;

/**
 * Effect of retiring a skill.
 *
 * A retired skill is a procedure the organism no longer has. The observable
 * consequence is reduced fluency with the conventions that procedure encoded,
 * which is `techLiteracy`. The magnitude is deliberately modest: one skill out
 * of a repertoire is a small loss, and claiming otherwise would make every
 * retirement look catastrophic.
 */
const RETIRE_SKILL_DELTA: TraitDelta = { trait: "techLiteracy", amount: -0.1 };

/**
 * An ordinal vocabulary for preference values, so `"high"` and `"0.8"` are both
 * usable. Values outside this vocabulary that do not parse as a number in
 * [0,1] make the mutation unprojectable rather than defaulting to a midpoint —
 * a default would silently measure something the proposal did not ask for.
 */
const ORDINALS: Readonly<Record<string, number>> = {
  none: 0,
  minimal: 0.15,
  low: 0.25,
  medium: 0.5,
  moderate: 0.5,
  high: 0.75,
  maximum: 1,
  max: 1,
};

function parseIntensity(value: string | undefined): number | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return null;
  // `Object.hasOwn`, not `in`: these tables are plain object literals, so `in`
  // and bracket access resolve inherited names. A proposed value of
  // "constructor" would otherwise yield a function where a number is expected
  // and propagate as NaN through every trait delta.
  if (Object.hasOwn(ORDINALS, normalized)) return ORDINALS[normalized] as number;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 1) return numeric;
  return null;
}

/**
 * Project a mutation onto operator trait deltas, or `null` when the mutation
 * has no measurable operational consequence.
 */
export function project(mutation: Mutation): Projection | null {
  switch (mutation.kind) {
    case "retire_skill":
      return {
        deltas: [RETIRE_SKILL_DELTA],
        explanation:
          `retiring skill "${mutation.target}" removes a known procedure, modelled as reduced ` +
          `fluency with software conventions (techLiteracy ${RETIRE_SKILL_DELTA.amount})`,
      };

    case "amend_genome":
      return projectGenomeAmendment(mutation);

    // Both are advisory in ADAM by construction: accepting one applies no
    // change to any subsystem. There is nothing for a simulation to observe.
    case "reconcile_belief":
    case "investigate_conflict":
      return null;
  }
}

function projectGenomeAmendment(mutation: Mutation): Projection | null {
  const [field, ...rest] = mutation.target.split(".");
  const suffix = rest.join(".");

  if (field === "preferences") {
    // Own-property check for the same reason as in `parseIntensity`: a target
    // of "preferences.constructor" would otherwise return the Object
    // constructor and throw when `.map` is called on it.
    const traits = Object.hasOwn(TRAIT_PROJECTIONS, suffix) ? TRAIT_PROJECTIONS[suffix] : undefined;
    if (!traits) return null;

    const after = parseIntensity(mutation.proposed_value);
    if (after === null) return null;
    // An absent or unparseable current value means the preference was unset;
    // the baseline is then whatever the persona already has, so the delta is
    // measured from the persona rather than from an assumed prior.
    const before = parseIntensity(mutation.current_value);
    const shift = (after - (before ?? after - PREFERENCE_MAGNITUDE)) * (1 / PREFERENCE_MAGNITUDE);
    const amount = Math.max(-1, Math.min(1, shift)) * PREFERENCE_MAGNITUDE;
    if (amount === 0) return null;

    return {
      deltas: traits.map((trait) => ({ trait, amount })),
      explanation:
        `preference "${suffix}" ${before === null ? "set to " : `moved ${before} → `}` +
        `${after}, projected onto ${traits.join(", ")} (${amount >= 0 ? "+" : ""}${amount.toFixed(2)})`,
    };
  }

  if (field === "policies") {
    const policy = (
      suffix === "remove" ? mutation.current_value : mutation.proposed_value
    )?.toLowerCase();
    if (!policy) return null;

    // Longest keyword first, so a specific phrase wins over a substring of it.
    const keyword = Object.keys(POLICY_KEYWORDS)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => policy.includes(candidate));
    if (!keyword) return null;

    const base = POLICY_KEYWORDS[keyword] as TraitDelta;
    // Removing a policy reverses its effect.
    const sign = suffix === "remove" ? -1 : 1;
    return {
      deltas: [{ trait: base.trait, amount: base.amount * sign }],
      explanation:
        `policy ${suffix === "remove" ? "removal" : "addition"} matched "${keyword}", ` +
        `projected onto ${base.trait} (${base.amount * sign >= 0 ? "+" : ""}${(base.amount * sign).toFixed(2)})`,
    };
  }

  // goals, values, capabilities: real genome changes with no direct operational
  // signature. They change what the organism pursues, not how it operates, and
  // a scenario suite measures the latter.
  return null;
}

/** Why a mutation could not be projected, phrased for a FitnessResult reason. */
export function explainUnprojectable(mutation: Mutation): string {
  switch (mutation.kind) {
    case "reconcile_belief":
      return "belief reconciliation is advisory and applies no change to any subsystem, so simulation has nothing to observe";
    case "investigate_conflict":
      return "conflict investigation is advisory and applies no change to any subsystem, so simulation has nothing to observe";
    case "retire_skill":
      return "skill retirement should always project; this indicates a defect in the projection table";
    case "amend_genome": {
      const [field, ...rest] = mutation.target.split(".");
      const suffix = rest.join(".");
      if (field === "preferences") {
        return Object.hasOwn(TRAIT_PROJECTIONS, suffix)
          ? `preference "${suffix}" has a projection but its value ${JSON.stringify(mutation.proposed_value ?? "")} is not an intensity in [0,1] or one of ${Object.keys(ORDINALS).join(", ")}`
          : `preference "${suffix}" has no declared operational projection; add one to TRAIT_PROJECTIONS if it changes observable behavior`;
      }
      if (field === "policies") {
        return "policy text matched no declared operational keyword; add one to POLICY_KEYWORDS if the policy changes observable behavior";
      }
      return `amendments to "${field}" change what the organism pursues rather than how it operates, which a scenario suite cannot measure`;
    }
  }
}

/** Apply trait deltas, clamping each trait to its own valid range. */
export function applyDeltas(traits: PersonaTraits, deltas: readonly TraitDelta[]): PersonaTraits {
  const next: PersonaTraits = { ...traits };
  for (const { trait, amount } of deltas) {
    const current = next[trait];
    // readingSpeedWpm is the one absolute trait; a 0..1 delta would be
    // meaningless against a value near 240, so it is scaled proportionally.
    next[trait] =
      trait === "readingSpeedWpm"
        ? Math.max(60, current * (1 + amount))
        : Math.max(0, Math.min(1, current + amount));
  }
  return next;
}
