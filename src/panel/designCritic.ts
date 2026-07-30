import type { Finding, Percept, VisibleElement } from "../core/types.js";
import { DEFAULT_ACCESSIBILITY } from "../personas/persona.js";
import { checkGeometry } from "../vision/analysis.js";
import { detectWorkflow } from "../workflow/detector.js";

/**
 * Design Critic — an expert reviewer independent of the human simulation.
 *
 * Where the simulated operator judges the experience *behaviorally* (by
 * using the product), the Design Critic performs *expert inspection*: a
 * heuristic evaluation (Nielsen & Molich 1990; Nielsen's 10 usability
 * heuristics) plus typography, layout, hierarchy, microcopy, forms,
 * navigation and onboarding heuristics, applied statically to each captured
 * screen. Combining behavioral testing with expert inspection is the classic
 * dual-method evaluation strategy — each finds problems the other misses
 * (Hertzum & Jacobsen 2001, the evaluator effect).
 *
 * Deterministic and offline by default; an optional LLM pass can be layered
 * via the `llm-critic` plugin during the session.
 */

export type Heuristic =
  | "visibility-of-status"
  | "match-real-world"
  | "user-control"
  | "consistency-standards"
  | "error-prevention"
  | "recognition-not-recall"
  | "flexibility-efficiency"
  | "aesthetic-minimalist"
  | "error-recovery"
  | "help-documentation"
  | "typography"
  | "layout-hierarchy"
  | "microcopy"
  | "forms"
  | "navigation"
  | "onboarding";

export interface CritiqueItem {
  readonly heuristic: Heuristic;
  readonly severity: "critical" | "major" | "minor";
  readonly title: string;
  readonly detail: string;
  readonly location: string;
  readonly recommendation: string;
}

export interface DesignCritique {
  readonly items: readonly CritiqueItem[];
  readonly byHeuristic: Readonly<Record<string, number>>;
  /** 0..100 heuristic-inspection score (higher is better). */
  readonly inspectionScore: number;
  readonly summary: string;
}

const GENERIC_CTA = /^(click here|submit|ok|go|button|link|read more|learn more)$/i;
const JARGON =
  /\b(oauth|webhook|payload|schema|api key|endpoint|token|null|undefined|500|404|cta|utm)\b/i;

/**
 * Critique a set of captured screens. `behavioralFindings` (from the
 * operator's run) are folded in so the critique can corroborate or extend
 * behavioral evidence, but the heuristic checks stand on their own.
 */
export function critiqueDesign(
  screens: readonly Percept[],
  behavioralFindings: readonly Finding[] = [],
): DesignCritique {
  const items: CritiqueItem[] = [];
  const seen = new Set<string>();
  const push = (item: CritiqueItem) => {
    const key = `${item.heuristic}:${item.title}:${item.location}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const screen of screens) {
    const where = screen.title || screen.url;

    // --- H1 Visibility of system status ---
    if (screen.loadingIndicator && screen.elements.length < 3) {
      push({
        heuristic: "visibility-of-status",
        severity: "minor",
        title: "Bare loading state",
        detail:
          "A loading indicator with almost no surrounding content leaves users unsure what is happening.",
        location: where,
        recommendation:
          "Show skeleton content or a message describing what is loading and roughly how long.",
      });
    }

    // --- H4 Consistency & standards: button label style ---
    const buttons = screen.elements.filter((e) => e.role === "button" && e.text.trim());
    const generic = buttons.filter((b) => GENERIC_CTA.test(b.text.trim()));
    if (generic.length >= 2) {
      push({
        heuristic: "consistency-standards",
        severity: "minor",
        title: `${generic.length} vague call-to-action label(s)`,
        detail: `Buttons like "${generic
          .map((g) => g.text.trim())
          .slice(0, 3)
          .join('", "')}" don't say what they do.`,
        location: where,
        recommendation:
          'Use action + object labels ("Create account", "Download invoice") instead of generic verbs.',
      });
    }

    // --- H2 Match the real world: jargon (microcopy) ---
    const jargonEls = screen.elements.filter((e) => e.text.length > 3 && JARGON.test(e.text));
    if (jargonEls.length > 0) {
      push({
        heuristic: "microcopy",
        severity: "minor",
        title: "Technical jargon in user-facing copy",
        detail: `Terms likely unfamiliar to end users appear on screen (e.g. "${jargonEls[0]!.text.trim().slice(0, 40)}").`,
        location: where,
        recommendation:
          "Replace implementation terms with the user's vocabulary, or explain them inline.",
      });
    }

    // --- Typography: too-small or too-many sizes ---
    const fontSizes = screen.elements
      .map((e) => e.fontSize)
      .filter((s): s is number => typeof s === "number");
    const distinctSizes = new Set(fontSizes.map((s) => Math.round(s)));
    if (distinctSizes.size > 8) {
      push({
        heuristic: "typography",
        severity: "minor",
        title: `Typographic scale sprawl (${distinctSizes.size} distinct sizes)`,
        detail:
          "Many different font sizes on one screen weaken hierarchy and read as inconsistent.",
        location: where,
        recommendation: "Adopt a constrained type scale (≈5–6 steps) and map roles to steps.",
      });
    }

    // --- Layout & hierarchy: no headings ---
    const headings = screen.elements.filter((e) => e.role === "heading" && e.text.trim());
    if (screen.elements.length > 8 && headings.length === 0) {
      push({
        heuristic: "layout-hierarchy",
        severity: "major",
        title: "No visible heading to anchor the page",
        detail: "A content-rich screen with no heading gives users nothing to orient against.",
        location: where,
        recommendation: "Add a clear page/section heading establishing where the user is.",
      });
    }

    // --- Forms: unlabeled fields, missing submit ---
    const fields = screen.elements.filter((e) => e.editable && !e.disabled);
    const unlabeled = fields.filter((f) => !f.text.trim());
    if (unlabeled.length > 0) {
      push({
        heuristic: "forms",
        severity: "major",
        title: `${unlabeled.length} form field(s) without a visible label`,
        detail:
          "Placeholder-only or unlabeled fields fail recognition and disappear once typing starts.",
        location: where,
        recommendation: "Give every field a persistent visible label.",
      });
    }
    if (fields.length >= 2 && !hasSubmit(screen.elements)) {
      push({
        heuristic: "forms",
        severity: "minor",
        title: "Form has fields but no obvious submit control",
        detail: "Users who fill the form can't tell how to complete it.",
        location: where,
        recommendation: "Provide a clearly-labeled primary submit button.",
      });
    }

    // --- Aesthetic & minimalist: choice overload ---
    const interactive = screen.elements.filter((e) => e.interactive && !e.disabled);
    if (interactive.length > 25) {
      push({
        heuristic: "aesthetic-minimalist",
        severity: "minor",
        title: `Dense screen: ${interactive.length} interactive elements`,
        detail:
          "Too many competing actions raises decision load (Hick–Hyman) and dilutes the primary task.",
        location: where,
        recommendation: "Establish a single primary action per screen and demote the rest.",
      });
    }

    // --- Recognition not recall / navigation: no way back ---
    const kind = detectWorkflow(screen).kind;
    if (
      (kind === "edit" || kind === "create" || kind === "settings") &&
      !hasBack(screen.elements)
    ) {
      push({
        heuristic: "user-control",
        severity: "minor",
        title: "No visible way to cancel or go back",
        detail:
          "Editing/creating screens without an escape hatch trap users (violates user control & freedom).",
        location: where,
        recommendation: "Always offer a visible Cancel/Back that abandons without side effects.",
      });
    }

    // --- Onboarding: first screen with no orientation ---
    if (kind === "dashboard" && headings.length > 0 && interactive.length > 12) {
      // Corroborated only if behavioral confusion was also seen.
      if (behavioralFindings.some((f) => f.url === screen.url && f.category === "usability")) {
        push({
          heuristic: "onboarding",
          severity: "minor",
          title: "Rich dashboard may overwhelm first-time users",
          detail:
            "A dense landing surface with no progressive disclosure raises first-run cognitive load.",
          location: where,
          recommendation:
            "Introduce empty states, a guided first task, or progressive disclosure for new users.",
        });
      }
    }

    // --- Accessibility geometry corroboration (contrast/overflow/etc.) ---
    for (const issue of checkGeometry(screen, DEFAULT_ACCESSIBILITY)) {
      if (issue.kind === "low-contrast") {
        push({
          heuristic: "typography",
          severity: issue.severityHint,
          title: "Low text contrast",
          detail: issue.detail,
          location: where,
          recommendation: "Meet WCAG AA contrast (4.5:1 body, 3:1 large text).",
        });
      }
    }
  }

  const byHeuristic: Record<string, number> = {};
  for (const item of items) byHeuristic[item.heuristic] = (byHeuristic[item.heuristic] ?? 0) + 1;

  const penalty = items.reduce(
    (sum, i) => sum + (i.severity === "critical" ? 12 : i.severity === "major" ? 6 : 2),
    0,
  );
  const inspectionScore = Math.max(0, Math.min(100, 100 - penalty));

  const summary =
    items.length === 0
      ? "Heuristic inspection found no notable interface issues across the captured screens."
      : `Heuristic inspection found ${items.length} issue(s) across ${screens.length} screen(s), spanning ${Object.keys(byHeuristic).length} heuristic categories. Inspection score ${inspectionScore}/100.`;

  return { items: rank(items), byHeuristic, inspectionScore, summary };
}

function hasSubmit(els: readonly VisibleElement[]): boolean {
  return els.some(
    (e) =>
      e.role === "button" &&
      /\b(submit|save|create|send|continue|next|log ?in|sign ?up|search|apply|confirm|done|pay|add)\b/i.test(
        e.text,
      ),
  );
}

function hasBack(els: readonly VisibleElement[]): boolean {
  return els.some((e) => /\b(back|cancel|close|return|discard)\b/i.test(e.text));
}

function rank(items: CritiqueItem[]): CritiqueItem[] {
  const order = { critical: 0, major: 1, minor: 2 };
  return [...items].sort((a, b) => order[a.severity] - order[b.severity]);
}
