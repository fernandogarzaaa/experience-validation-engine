/**
 * Metric recognition.
 *
 * "Revenue: $1.24M (up 14% QoQ)" is not a sentence — it is a claim a reader
 * is expected to act on. Pulling out the value, its unit and, crucially,
 * whether the artifact offered a *baseline* is what lets the comprehension
 * model say the thing every analytics reader thinks and rarely says out
 * loud: "compared to what?"
 */

import type { MetricDetail } from "../types.js";

/** "Label: value" or "Label — value"; the label carries at least one word. */
const LABELLED = /^([A-Za-z][\w %()/&.'-]{1,48}?)\s*(?::|—|–|\s-\s)\s*(.+)$/;

/** A number with optional currency/percent/magnitude decoration. */
const QUANTITY =
  /^([+-]?[$£€¥]?\s?\d[\d,_]*(?:\.\d+)?)\s*(%|[KkMmBbTt]\b|ms\b|s\b|min\b|hrs?\b|days?\b|MB\b|GB\b|TB\b|req\/s\b|rps\b|USD\b|EUR\b|GBP\b)?/;

/**
 * A comparison the reader can anchor on: an explicit vs/from/versus phrase,
 * a period-over-period abbreviation, or a signed change.
 */
const BASELINE =
  /\b(?:vs\.?|versus|compared with|compared to|up from|down from|from)\s+[^,;)]+|(?:\b(?:QoQ|YoY|MoM|WoW|DoD)\b)|(?:[+-]\s?\d+(?:\.\d+)?\s?%)/i;

/**
 * Parse a line as a metric, or return null when it is prose.
 *
 * Deliberately conservative: a line only counts when a short label is
 * followed by something that *starts* with a quantity. "We grew 14% last
 * year" is a sentence about a number, not a metric a dashboard is asserting,
 * and treating it as one would flood analytics reports with false positives.
 */
export function parseMetric(line: string): MetricDetail | null {
  const text = line.trim();
  if (!text || text.length > 160) return null;

  const labelled = LABELLED.exec(text);
  if (!labelled) return null;

  const label = (labelled[1] ?? "").trim();
  const remainder = (labelled[2] ?? "").trim();
  const quantity = QUANTITY.exec(remainder);
  if (!quantity) return null;
  // A label that is itself a number ("2024: strong") is a list, not a metric.
  if (/^[\d\s.,%-]+$/.test(label)) return null;

  const baseline = BASELINE.exec(remainder);
  return {
    label,
    value: (quantity[1] ?? "").replace(/\s+/g, ""),
    unit: quantity[2] ?? null,
    baseline: baseline ? baseline[0].trim() : null,
  };
}
