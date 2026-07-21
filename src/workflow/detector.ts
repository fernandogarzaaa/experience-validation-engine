import type { Percept } from "../core/types.js";
import { WORKFLOW_SIGNATURES, type WorkflowKind } from "./catalog.js";

/**
 * Classify the workflow a screen belongs to, from perception alone.
 * Returns the best-scoring workflow kind plus a confidence in 0..1.
 */
export interface WorkflowMatch {
  readonly kind: WorkflowKind;
  readonly confidence: number;
}

export function detectWorkflow(percept: Percept): WorkflowMatch {
  const urlAndTitle = `${percept.url} ${percept.title}`;
  const headings = percept.elements
    .filter((e) => e.role === "heading")
    .map((e) => e.text)
    .join(" ");
  const controls = percept.elements
    .filter((e) => e.interactive || e.editable)
    .map((e) => e.text)
    .join(" ");

  let best: WorkflowMatch = { kind: "unknown", confidence: 0 };
  for (const sig of WORKFLOW_SIGNATURES) {
    let score = 0;
    for (const re of sig.urlHints) if (re.test(urlAndTitle)) score += 0.5;
    for (const re of sig.contentHints) if (re.test(headings) || re.test(urlAndTitle)) score += 0.35;
    for (const re of sig.controlHints) if (re.test(controls)) score += 0.2;

    if (sig.kind === "form") {
      // Generic form requires actual fields to qualify.
      const fields = percept.elements.filter((e) => e.editable && !e.disabled).length;
      score = fields >= 2 && score > 0 ? Math.min(score, 0.45) : 0;
    }

    const confidence = Math.min(1, score);
    if (confidence > best.confidence) best = { kind: sig.kind, confidence };
  }
  return best.confidence >= 0.3 ? best : { kind: "unknown", confidence: best.confidence };
}
