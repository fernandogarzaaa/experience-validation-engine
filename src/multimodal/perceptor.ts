/**
 * The default, deterministic multimodal perceptor. It recognizes visual
 * constructs from the perceived elements, loading indicator, and dialogs of a
 * `Percept` — and, when real screenshots are present, motion between frames.
 */

import type { Percept, VisibleElement } from "../core/types.js";
import { decodePng, frameDiffRatio } from "../vision/index.js";
import type { MultimodalCue, MultimodalCues, MultimodalPerceptor } from "./types.js";

const CHART_PATTERN = /chart|graph|plot|trend|analytics|sparkline|histogram|\bpie\b|\bbar\b/i;
const TOAST_PATTERN =
  /saved|success|error|copied|sent|added|deleted|updated|removed|failed|welcome/i;
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem"]);

/** An interactive control with no readable text is an icon-only affordance. */
function isIconOnly(el: VisibleElement): boolean {
  return el.interactive && INTERACTIVE_ROLES.has(el.role) && el.text.trim().length <= 1;
}

export class HeuristicMultimodalPerceptor implements MultimodalPerceptor {
  readonly name = "heuristic";

  perceive(percept: Percept, previous?: Percept): MultimodalCues {
    const cues: MultimodalCue[] = [];

    for (const el of percept.elements) {
      const text = el.text.trim();
      if (el.role === "image") {
        cues.push({
          kind: "media",
          label: text || "(unlabeled image)",
          accessible: text.length > 0,
        });
        if (text) cues.push({ kind: "text-in-image", label: text, accessible: true });
        if (CHART_PATTERN.test(text)) {
          cues.push({ kind: "chart", label: text, accessible: text.length > 0 });
        }
      } else if (el.role === "table" && CHART_PATTERN.test(text)) {
        cues.push({ kind: "chart", label: text || "(data table)", accessible: text.length > 0 });
      }
      if (isIconOnly(el)) {
        cues.push({ kind: "icon", label: "(icon-only control)", accessible: false });
      }
      if (el.role === "alert" && text) {
        cues.push({ kind: "toast", label: text, accessible: true });
      }
    }

    if (percept.loadingIndicator || percept.elements.some((e) => e.role === "progress")) {
      cues.push({ kind: "loading", label: "loading indicator", accessible: true });
    }

    for (const dialog of percept.dialogs) {
      const text = dialog.text.trim();
      if (text && TOAST_PATTERN.test(text)) {
        cues.push({ kind: "toast", label: text, accessible: true });
      }
    }

    // Motion: only computable when real screenshots exist on both frames.
    if (previous?.screenshot && percept.screenshot) {
      try {
        const diff = frameDiffRatio(decodePng(previous.screenshot), decodePng(percept.screenshot));
        if (diff > 0.02 && diff < 0.5) {
          cues.push({
            kind: "animation",
            label: `frame change ${Math.round(diff * 100)}%`,
            accessible: true,
          });
        }
      } catch {
        // Undecodable screenshots — skip motion detection for this frame.
      }
    }

    return { screen: percept.url, cues };
  }
}

/** The shared default perceptor instance. */
export const DEFAULT_MULTIMODAL_PERCEPTOR: MultimodalPerceptor = new HeuristicMultimodalPerceptor();
