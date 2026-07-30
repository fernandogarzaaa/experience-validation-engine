/**
 * Aggregate multimodal cues across a session's perceived screens into a report,
 * surfacing perception risks (unlabeled icons/charts/media) and dynamic UI
 * (loading states, toasts).
 */

import type { Percept } from "../core/types.js";
import type { SessionResult } from "../engine/session.js";
import { DEFAULT_MULTIMODAL_PERCEPTOR } from "./perceptor.js";
import type { CueKind, MultimodalPerceptor, MultimodalReport } from "./types.js";

const ALL_KINDS: readonly CueKind[] = [
  "icon",
  "chart",
  "media",
  "loading",
  "toast",
  "text-in-image",
  "animation",
];

/** Analyze the multimodal perception of a set of perceived screens. */
export function analyzeScreens(
  screens: readonly Percept[],
  perceptor: MultimodalPerceptor = DEFAULT_MULTIMODAL_PERCEPTOR,
): MultimodalReport {
  const byKind = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<CueKind, number>;
  const unlabeled: { kind: CueKind; screen: string }[] = [];
  const toasts: { screen: string; label: string }[] = [];
  let screensWithLoading = 0;
  let total = 0;

  let previous: Percept | undefined;
  for (const percept of screens) {
    const { cues } = perceptor.perceive(percept, previous);
    previous = percept;
    let sawLoading = false;
    for (const cue of cues) {
      byKind[cue.kind] += 1;
      total += 1;
      if (
        !cue.accessible &&
        (cue.kind === "icon" || cue.kind === "chart" || cue.kind === "media")
      ) {
        unlabeled.push({ kind: cue.kind, screen: percept.url });
      }
      if (cue.kind === "toast") toasts.push({ screen: percept.url, label: cue.label });
      if (cue.kind === "loading") sawLoading = true;
    }
    if (sawLoading) screensWithLoading += 1;
  }

  return {
    perceptor: perceptor.name,
    screensAnalyzed: screens.length,
    totalCues: total,
    byKind,
    unlabeled: unlabeled.slice(0, 30),
    screensWithLoading,
    toasts: toasts.slice(0, 30),
    generatedAt: new Date().toISOString(),
  };
}

/** Analyze the multimodal perception captured across a whole session. */
export function analyzeMultimodal(
  session: SessionResult,
  perceptor: MultimodalPerceptor = DEFAULT_MULTIMODAL_PERCEPTOR,
): MultimodalReport {
  return analyzeScreens(session.capturedScreens, perceptor);
}
