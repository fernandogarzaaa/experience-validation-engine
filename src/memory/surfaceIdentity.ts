import type { Percept } from "../core/types.js";

/**
 * Two-tier surface identity (P0.5, reviewer decision 1).
 *
 * ```text
 * SurfaceIdentity  (stable structural identity)
 * SurfaceState     (mutable interaction/semantic state)
 * OutcomeEvidence  (transition/result evidence — see planning/evidence.ts)
 * ```
 *
 * A single key cannot serve both tried-affordance memory and workflow
 * attribution: a key that forks on every keystroke or focus move orphans
 * tried-marks and loops forever (regression: tests/memory-identity.test.ts),
 * while a key that ignores query tabs, dialogs and validation errors aliases
 * materially different states. So:
 *
 * - `stableIdentityKey` — origin + path, layout roles + geometry, heading
 *   gist. NEVER forks on: typing, focus moves, enable/disable toggles,
 *   dialog TEXT, query values, keyboard band, error appearance. Used for
 *   tried-affordances, familiarity, recognition, revisit detection.
 * - `sensitiveStateKey` — stable + classified query values + dialog texts +
 *   validation-error signal + keyboard band. Used for workflow attribution,
 *   transition analysis, outcome interpretation, state-specific findings.
 *
 * `screenSignature()` in `./memory.js` is unchanged (backwards compat);
 * `surfaceIdentity()` remains as a deprecated alias of the stable key.
 */

export interface QueryStatePolicy {
  /**
   * Query keys whose values are semantic UI state (tabs, views, steps).
   * Short values discriminate verbatim; longer ones are bucketed.
   */
  readonly stateBearingKeys: readonly string[];
  /**
   * Query keys with high-cardinality user/opaque data. Always bucketed,
   * never verbatim — they must not explode the state graph.
   */
  readonly highCardinalityKeys: readonly string[];
  /** Max length for a verbatim state-bearing value. */
  readonly shortValueMaxLength: number;
}

export const DEFAULT_QUERY_STATE_POLICY: QueryStatePolicy = {
  stateBearingKeys: [
    "tab",
    "view",
    "mode",
    "step",
    "page",
    "sort",
    "filter",
    "section",
    "stage",
    "pane",
    "panel",
  ],
  highCardinalityKeys: ["q", "search", "query", "session", "tracking", "token", "id", "sid"],
  shortValueMaxLength: 24,
};

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function originPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Length bucket for high-cardinality values (never verbatim). */
function bucket(v: string): string {
  return v.length <= 24 ? "s" : v.length <= 96 ? "m" : "l";
}

export type QueryParameterClassification = "state-bearing" | "high-cardinality" | "unknown-key";

export type QueryNormalization = "verbatim" | "bucketed";

/**
 * Explainable per-parameter query classification (reviewer: identity
 * behavior must be debuggable). Each normalized component reports what it
 * is, how it was normalized, and why.
 */
export interface QueryStateClassification {
  readonly parameter: string;
  readonly classification: QueryParameterClassification;
  readonly normalization: QueryNormalization;
  readonly normalized: string;
  readonly reason: string;
}

/** Classify every query parameter of a URL without discarding information. */
export function classifyQueryDetailed(
  url: string,
  policy: QueryStatePolicy = DEFAULT_QUERY_STATE_POLICY,
): readonly QueryStateClassification[] {
  try {
    const u = new URL(url);
    const keys = [...u.searchParams.keys()].sort();
    const state = new Set(policy.stateBearingKeys.map((k) => k.toLowerCase()));
    const cardinal = new Set(policy.highCardinalityKeys.map((k) => k.toLowerCase()));
    return keys.map((k) => {
      const v = u.searchParams.get(k) ?? "";
      const lk = k.toLowerCase();
      if (cardinal.has(lk)) {
        return {
          parameter: k,
          classification: "high-cardinality" as const,
          normalization: "bucketed" as const,
          normalized: `${k}=${bucket(v)}`,
          reason: `"${k}" is a high-cardinality key: values must not explode the state graph`,
        };
      }
      if (state.has(lk) && v.length <= policy.shortValueMaxLength) {
        return {
          parameter: k,
          classification: "state-bearing" as const,
          normalization: "verbatim" as const,
          normalized: `${k}=${v}`,
          reason: `"${k}" is a state-bearing key with a short (${v.length}ch) value`,
        };
      }
      if (state.has(lk)) {
        return {
          parameter: k,
          classification: "state-bearing" as const,
          normalization: "bucketed" as const,
          normalized: `${k}=${bucket(v)}`,
          reason: `"${k}" is state-bearing but the value (${v.length}ch) exceeds shortValueMaxLength=${policy.shortValueMaxLength}`,
        };
      }
      return {
        parameter: k,
        classification: "unknown-key" as const,
        normalization: "bucketed" as const,
        normalized: `${k}=${bucket(v)}`,
        reason: `"${k}" is in neither key list: bucketed conservatively (add it to the policy to discriminate it)`,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Classified query string for the SENSITIVE tier (reviewer decision 2):
 * state-bearing keys discriminate verbatim when short, everything else is
 * bucketed. Configurable via `QueryStatePolicy` — the length cutoff is a
 * safety mechanism, not the semantic rule.
 */
export function classifiedQuery(
  url: string,
  policy: QueryStatePolicy = DEFAULT_QUERY_STATE_POLICY,
): string {
  return classifyQueryDetailed(url, policy)
    .map((p) => p.normalized)
    .join("&");
}

function structurePart(percept: Percept): string {
  // Roles + geometry of interactive elements — deliberately NO label text,
  // NO focus flag, NO disabled flag, NO alerts (an appearing validation
  // error must not fork the stable key or tried-marks orphan — see header).
  // Heading text IS included: same-layout screens ("Login" vs "Sign up")
  // need discrimination, and field values never appear in headings.
  const items = percept.elements
    .filter((e) => e.interactive || e.editable || e.role === "heading" || e.role === "menuitem")
    .map((e) => {
      const b = e.box;
      const geo = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}`;
      const label = e.role === "heading" ? e.text.trim().toLowerCase().slice(0, 40) : "";
      return `${e.role}@${geo}:${label}`;
    })
    .sort();
  return hashStr(items.join("|"));
}

/** Stable structural identity — see header for the tier contract. */
export function stableIdentityKey(percept: Percept): string {
  return [originPath(percept.url), structurePart(percept)].join("::");
}

export interface SensitiveStateOptions {
  readonly queryPolicy?: QueryStatePolicy;
  /**
   * Whether the screen carries a validation/error state (the session passes
   * its already-computed error perception — no layer violation, no import
   * cycle with cognition). Distinguishes "same form, validation-error".
   */
  readonly errorSignal?: boolean;
  /**
   * Form fill state tracked from the ACTION stream (reviewer adversarial
   * matrix: "form empty / form populated" must not collapse at the
   * sensitive tier). Perception alone cannot reliably separate an empty
   * field from a filled one across adapters, so the session — which knows
   * which type actions succeeded — supplies it. Omitted → neutral ("-").
   */
  readonly formFill?: "empty" | "populated";
}

/** Mutable semantic state — stable key plus state-bearing distinctions. */
export function sensitiveStateKey(percept: Percept, opts: SensitiveStateOptions = {}): string {
  const query = classifiedQuery(percept.url, opts.queryPolicy);
  const dialogs =
    percept.dialogs.length === 0
      ? "-"
      : `dlg:${hashStr(
          percept.dialogs
            .map((x) => `${x.source ?? "dom"}:${x.text.slice(0, 80)}`)
            .sort()
            .join("||"),
        )}`;
  const kb = percept.keyboardOcclusion ? "kb" : "-";
  const err = opts.errorSignal ? "err" : "-";
  const fill = opts.formFill === "populated" ? "pop" : opts.formFill === "empty" ? "clr" : "-";
  return [stableIdentityKey(percept), query || "-", dialogs, kb, err, fill].join("::");
}

/**
 * @deprecated Prefer `stableIdentityKey` (tried-marks, familiarity,
 * recognition) or `sensitiveStateKey` (workflow, transitions, outcomes).
 * Byte-identical to `stableIdentityKey`.
 */
export function surfaceIdentity(percept: Percept): string {
  return stableIdentityKey(percept);
}

/** True when two percepts share stable structural identity. */
export function sameSurface(a: Percept, b: Percept): boolean {
  return stableIdentityKey(a) === stableIdentityKey(b);
}

/** True when two percepts share full semantic state. */
export function sameState(a: Percept, b: Percept, opts: SensitiveStateOptions = {}): boolean {
  return sensitiveStateKey(a, opts) === sensitiveStateKey(b, opts);
}
