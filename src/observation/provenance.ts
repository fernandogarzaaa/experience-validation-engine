import type {
  EvidenceProvenance,
  ObservationSource,
  Percept,
  VisibleElement,
} from "../core/types.js";

/**
 * Evidence-provenance helpers (P0.3 / P1.10).
 *
 * The perception script tags each element's `textSource`; these helpers let
 * cognition and evaluation ask "where did this string come from?" instead of
 * treating every string as seen. Accessibility fallbacks (aria-label, alt,
 * title) remain available for accessibility testing — they are labeled, not
 * removed.
 */

/** Where an element's text came from; legacy elements default to visual-or-unknown. */
export function textSourceOf(el: VisibleElement): ObservationSource {
  return el.textSource ?? "visual";
}

/** True when a sighted human would literally read this element's text. */
export function isHumanVisibleText(el: VisibleElement): boolean {
  return textSourceOf(el) === "visual";
}

/** Elements whose text a sighted human reads (aria/alt/title fallbacks excluded). */
export function visuallyGroundedElements(percept: Percept): readonly VisibleElement[] {
  return percept.elements.filter(isHumanVisibleText);
}

/**
 * Visible text grounded in rendered pixels only. Contrast with `visibleText`,
 * which includes accessibility fallbacks for backwards compatibility and
 * accessibility auditing. Goal and error evidence should prefer this when
 * the claim is "the human saw X".
 */
export function visualOnlyText(percept: Percept): string {
  const parts: string[] = [];
  if (percept.title) parts.push(percept.title);
  for (const el of percept.elements) {
    if (isHumanVisibleText(el) && el.text) parts.push(el.text);
  }
  for (const d of percept.dialogs) parts.push(d.text);
  return parts.join("\n");
}

/** Accessibility-sourced strings, kept available for accessibility testing. */
export function accessibilitySourcedText(percept: Percept): string {
  return percept.elements
    .filter((el) => textSourceOf(el) === "accessibility" && el.text)
    .map((el) => el.text)
    .join("\n");
}

/** Classify a metric/finding's epistemic status for reporting. */
export function provenanceOf(
  kind: "observed" | "derived" | "heuristic" | "model",
): EvidenceProvenance {
  switch (kind) {
    case "observed":
      return "observed";
    case "derived":
      return "derived";
    case "heuristic":
      return "heuristic";
    case "model":
      return "model-inferred";
  }
}
