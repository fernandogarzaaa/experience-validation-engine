/**
 * Core domain types shared across every EVE module.
 *
 * The guiding constraint of the whole system: the simulated operator may only
 * ever act on information a human could perceive through a screen. Types in
 * this file model that boundary explicitly — a {@link Percept} contains only
 * human-visible information (pixels, visible text, layout geometry, the URL
 * bar, loading indicators), never DOM internals, network traffic, console
 * output or source code.
 *
 * **Phase 2 note (modality-variant kernel):** {@link Percept} and the eleven
 * browser-flavored {@link Action} kinds are the *deprecated web view* of the
 * modality-agnostic kernel in `src/core/kernel.ts` (`KernelPercept`,
 * `Affordance`, `SurfaceSignal`, `KernelAction`). They remain the session
 * contract and are fully supported — existing adapters and consumers keep
 * working unchanged — but new surface vocabulary (new verbs, new signal
 * types, new affordance kinds) is added to the kernel, not to these shapes.
 */

/**
 * Where one perceived fact came from. A human-visible label and an
 * accessibility-tree label are different evidence sources even when the
 * string is identical — cognition must never silently receive DOM-only
 * facts as though a human literally saw them (P0.3).
 *
 * - "visual": rendered pixels / visible text a sighted human reads.
 * - "dom": DOM-derived metadata (tag, tabIndex, cursor, CSS) — useful, not seen.
 * - "accessibility": accessibility-tree facts (aria-label, alt, title
 *   fallback, focus) — available to assistive tech, not sight.
 * - "surface": surface-reported signals (URL bar, loading indicator, native
 *   dialog text) — perceived through chrome, not page content.
 * - "modeled": computed by EVE (keyboard occlusion, reach cost) — never sensed.
 */
export type ObservationSource = "visual" | "dom" | "accessibility" | "surface" | "modeled";

/**
 * Epistemic status of a number or finding. Consumers can inspect where a
 * value came from instead of treating a heuristic like a measurement (P1.5).
 *
 * - "observed": directly perceived in simulation (clicks, transitions).
 * - "derived": computed from observations (rates, means, Wilson bounds on
 *   the *simulation* sample).
 * - "heuristic": hand-weighted formula, not fitted to human data.
 * - "model-inferred" / "llm-inferred": produced by a model (LLM critic).
 * - "human-calibrated": fitted against real human traces.
 * - "externally-validated": confirmed against held-out human data.
 * - "modeled": synthetic stand-in for unobservable behavior.
 */
export type EvidenceProvenance =
  | "observed"
  | "derived"
  | "heuristic"
  | "model-inferred"
  | "llm-inferred"
  | "human-calibrated"
  | "externally-validated"
  | "modeled";

/** Axis-aligned rectangle in CSS pixels, viewport-relative. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in CSS pixels, viewport-relative. */
export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Coarse perceptual role of a visible element, as a human would classify it
 * at a glance ("that's a button", "that's a text field"). This is inferred
 * from rendered appearance/semantics, not from framework internals.
 */
export type PerceivedRole =
  | "button"
  | "link"
  | "textbox"
  | "checkbox"
  | "radio"
  | "select"
  | "slider"
  | "tab"
  | "menuitem"
  | "image"
  | "heading"
  | "text"
  | "listitem"
  | "dialog"
  | "alert"
  | "progress"
  | "table"
  | "unknown";

/**
 * One element a human could see on screen right now.
 *
 * This is EVE's "retina abstraction": a stand-in for OCR + visual object
 * recognition. It is deliberately restricted to what is *actually rendered
 * and visible* — hidden elements, off-screen content, aria-only metadata and
 * DOM structure are excluded by the perception script.
 */
export interface VisibleElement {
  /** Ephemeral perceptual id, stable only within a single percept. */
  readonly id: number;
  readonly role: PerceivedRole;
  /** Visible text content, truncated to what a human reads at a glance. */
  readonly text: string;
  /**
   * Where `text` came from (P0.3). "visual" = rendered text a sighted human
   * reads; "accessibility" = aria-label/alt/title/placeholder fallback a
   * sighted human does NOT see; "dom" = structural inference. Optional so
   * existing literals keep working; absent means "visual-or-unknown (legacy)".
   */
  readonly textSource?: ObservationSource;
  readonly box: BoundingBox;
  /** Whether the element visually affords interaction (cursor, tag, tabindex). */
  readonly interactive: boolean;
  /** Visually disabled (greyed out / disabled attribute). */
  readonly disabled: boolean;
  /** Accepts typed input. */
  readonly editable: boolean;
  /** Currently holds keyboard focus (visible via focus ring). */
  readonly focused: boolean;
  /** Whether the element is fully inside the viewport (vs partially clipped). */
  readonly clippedByViewport: boolean;
  /**
   * True when a modeled soft-keyboard band covers this element (see
   * {@link Percept.keyboardOcclusion}). A distinct fact from
   * `clippedByViewport`: that flag is horizontal CSS overflow computed by the
   * perception script from real layout; this one is a vertical, dynamic
   * overlay modeled by the observation layer for touch surfaces, not
   * perceived from the page. Absent (not merely false) on adapters that never
   * compute it.
   */
  readonly occludedByKeyboard?: boolean;
  /** Perceived foreground/background colors when resolvable, as #rrggbb. */
  readonly color?: string;
  readonly backgroundColor?: string;
  /** Font size in CSS pixels when resolvable. */
  readonly fontSize?: number;
}

/** A modal dialog / alert visibly blocking or overlaying the page. */
export interface VisibleDialog {
  readonly text: string;
  readonly box: BoundingBox | null;
  /**
   * "native" = browser-native alert/confirm/prompt surfaced by the adapter
   * (P0.2); "dom" = in-page dialog element. Optional for backwards compat.
   */
  readonly source?: "dom" | "native";
  /**
   * How the adapter handled a blocking native dialog. Real native dialogs
   * block the page until handled, so the adapter must dismiss/accept to
   * unblock — but that handling is recorded here rather than silently
   * treated as the operator's decision. Default/safe is "dismissed".
   */
  readonly autoHandled?: "accepted" | "dismissed" | null;
}

/**
 * Everything the operator perceives in one glance at the screen.
 */
export interface Percept {
  /** Milliseconds since session start. */
  readonly timestamp: number;
  /** The URL bar is visible to humans. */
  readonly url: string;
  /** The tab title is visible to humans. */
  readonly title: string;
  readonly viewport: Viewport;
  readonly scrollY: number;
  readonly scrollHeight: number;
  /** PNG-encoded screenshot, when the adapter can produce one. */
  readonly screenshot: Buffer | null;
  readonly elements: readonly VisibleElement[];
  readonly dialogs: readonly VisibleDialog[];
  /** A visible loading indicator (spinner, skeleton, progress bar) is present. */
  readonly loadingIndicator: boolean;
  /**
   * Viewport-relative rect a modeled soft keyboard covers, or null when none
   * is up. Only ever set on touch surfaces with a focused editable element;
   * modeled from the device's `softKeyboardHeightPx`, not perceived — no
   * headless browser renders a real IME. Optional (not just nullable) so
   * every existing `Percept` literal in tests and non-touch adapters is
   * unaffected.
   */
  readonly keyboardOcclusion?: BoundingBox | null;
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

export type Action =
  | { kind: "click"; target: VisibleElement; point?: Point }
  | { kind: "doubleClick"; target: VisibleElement }
  | { kind: "hover"; target: VisibleElement }
  | { kind: "type"; target: VisibleElement; text: string }
  | { kind: "press"; key: string }
  | { kind: "scroll"; deltaY: number }
  | { kind: "navigate"; url: string }
  | { kind: "back" }
  | { kind: "read"; target: VisibleElement | null; durationMs: number }
  | { kind: "wait"; durationMs: number }
  | { kind: "abandon"; reason: string }
  | {
      /**
       * Phase 2: a kernel-native action — one semantic act on a surface that
       * declares its own verb registry via `SurfaceCapabilities.actionVerbs`
       * (e.g. a single `mcp.invoke` carrying typed tool arguments). Executed
       * through the adapter's kernel actuator (`KernelSurface.actKernel`), not
       * decomposed into synthetic UI gestures. See `src/core/kernel.ts`.
       */
      kind: "invoke";
      /** Registry-backed verb, e.g. "mcp.invoke". */
      verb: string;
      target: VisibleElement | null;
      /** Typed, surface-defined payload (structured arguments — no coercion). */
      payload?: unknown;
    };

export function describeAction(action: Action): string {
  switch (action.kind) {
    case "click":
      return `click "${label(action.target)}"`;
    case "doubleClick":
      return `double-click "${label(action.target)}"`;
    case "hover":
      return `hover over "${label(action.target)}"`;
    case "type":
      return `type "${action.text}" into "${label(action.target)}"`;
    case "press":
      return `press ${action.key}`;
    case "scroll":
      return action.deltaY >= 0 ? "scroll down" : "scroll up";
    case "navigate":
      return `navigate to ${action.url}`;
    case "back":
      return "go back";
    case "read":
      return action.target ? `read "${label(action.target)}"` : "read the screen";
    case "wait":
      return `wait ${Math.round(action.durationMs)}ms`;
    case "abandon":
      return `give up: ${action.reason}`;
    case "invoke":
      return describeInvoke(action.verb, action.payload);
  }
}

/**
 * Describe a kernel-native action by what it is. An MCP tool call reads as
 * `invoke add({"a":2})` — the evidence chain names the tool and its typed
 * arguments rather than "type 2 into a" (projection debt ledger item 1).
 */
function describeInvoke(verb: string, payload: unknown): string {
  if (verb === "mcp.invoke" && isToolInvocation(payload)) {
    return `invoke ${payload.tool}(${JSON.stringify(payload.arguments ?? {})})`;
  }
  const suffix = payload === undefined ? "" : ` ${JSON.stringify(payload)}`;
  return `${verb}${suffix}`;
}

function isToolInvocation(payload: unknown): payload is { tool: string; arguments?: unknown } {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { tool?: unknown }).tool === "string"
  );
}

function label(el: VisibleElement): string {
  const text = el.text.trim().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 45)}...` : text || `${el.role}#${el.id}`;
}

/* ------------------------------------------------------------------ */
/* Predictions & expectation checking                                 */
/* ------------------------------------------------------------------ */

/**
 * Before acting, the operator predicts what will happen. After acting, the
 * prediction is compared against reality and the gap drives emotion,
 * learning and findings ("expectation violations").
 */
export interface Prediction {
  /** Natural-language statement of the expected outcome. */
  readonly description: string;
  /**
   * Words/phrases the operator expects to perceive on the next screen if the
   * prediction holds (matched against visible text, title and URL).
   */
  readonly expectedSignals: readonly string[];
  /** Whether the operator expects the screen to change at all. */
  readonly expectsChange: boolean;
  /** 0..1 subjective confidence in the prediction. */
  readonly confidence: number;
}

export interface PredictionOutcome {
  readonly prediction: Prediction;
  /** 0 = exactly as expected, 1 = nothing like expected. */
  readonly surprise: number;
  readonly matchedSignals: readonly string[];
  readonly missedSignals: readonly string[];
  /** Did the screen change at all? */
  readonly screenChanged: boolean;
  /** A visible error message appeared. */
  readonly errorPerceived: boolean;
  /** Perceived wait between action and settled screen, in ms. */
  readonly perceivedLatencyMs: number;
  /**
   * Where the latency number came from (reviewer decision 3). The evaluator
   * can choose whether environmental variance participates in the model —
   * real latency is never hidden, never silently smoothed.
   */
  readonly latencyEvidence?: LatencyEvidence;
  /** Modeled human time (hesitation + motor + typing) for this action, in ms. */
  readonly motorTimeMs?: number;
}

/**
 * Latency provenance for one interaction (reviewer decision 3).
 *
 * - `modeledMs`: elapsed time on the session clock (simulated human time +
 *   modeled waits in deterministic mode; pace-scaled sleeps in wall mode).
 * - `observedMs`: elapsed WALL time on the host for the same interval —
 *   environmental reality, recorded always, used for appraisal only in
 *   wall-clock mode.
 * - `source`: which one `perceivedLatencyMs` was taken from.
 */
export interface LatencyEvidence {
  readonly modeledMs: number;
  readonly observedMs: number;
  readonly source: "modeled" | "environmental";
  readonly deterministic: boolean;
}

/* ------------------------------------------------------------------ */
/* Findings, evidence & scoring                                       */
/* ------------------------------------------------------------------ */

export type FindingSeverity = "critical" | "major" | "minor" | "info";

/**
 * The built-in finding categories, pre-registered in
 * `findingCategoryRegistry` (`src/core/findingCategories.ts`). The registry
 * is the source of truth at runtime; this tuple pins the serialized values
 * the type-level union is derived from, so existing `FindingCategory` types
 * and stored reports are unaffected.
 */
export const FINDING_CATEGORIES = [
  "usability",
  "navigation",
  "visual",
  "accessibility",
  "performance",
  "content",
  "error-recovery",
  "expectation-violation",
  "workflow",
  "consistency",
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/**
 * A finding's category: one of the built-ins above, or any id registered in
 * `findingCategoryRegistry` (Phase 0/2 — the registry is the runtime source
 * of truth, so the type-level vocabulary is open). The `(string & {})`
 * trick keeps built-in autocomplete while admitting registered ids like
 * `mcp.robustness`.
 */
export type FindingCategoryId = FindingCategory | (string & {});

export interface Finding {
  readonly id: string;
  readonly severity: FindingSeverity;
  readonly category: FindingCategoryId;
  readonly title: string;
  readonly description: string;
  /** What the operator was doing / seeing when this was found. */
  readonly evidence: readonly string[];
  readonly url: string;
  readonly timestamp: number;
  /** Screenshot index in the session gallery, when captured. */
  readonly screenshotIndex?: number;
  readonly recommendation?: string;
  /**
   * Epistemic status of this finding (P1.10/P1.11). An LLM-generated
   * critique ("llm-inferred"/"model-inferred") must never appear identical
   * to an observed interaction failure ("observed").
   */
  readonly provenance?: EvidenceProvenance;
  /** Model identifier when provenance is model/llm-inferred. */
  readonly modelId?: string;
  /** Whether a screenshot was supplied as evidence for this finding. */
  readonly screenshotBacked?: boolean;
  /** Whether a deterministic rule independently supports this finding. */
  readonly ruleBacked?: boolean;
}

/**
 * The built-in score dimensions, pre-registered in `dimensionRegistry`
 * (`src/scoring/dimensions.ts`). The registry is the runtime source of
 * truth; this tuple pins the serialized values the type-level union is
 * derived from, so existing `ScoreDimension` types and stored reports are
 * unaffected.
 */
export const SCORE_DIMENSIONS = [
  "overall",
  "usability",
  "learnability",
  "accessibility",
  "efficiency",
  "consistency",
  "visualDesign",
  "navigation",
  "workflowQuality",
  "informationArchitecture",
  "onboarding",
  "errorRecovery",
  "responsiveness",
  "userConfidence",
  "cognitiveLoad",
  "trust",
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/**
 * A score's dimension: one of the built-ins above, or any id registered in
 * `dimensionRegistry` (the registry is the runtime source of truth, so the
 * type-level vocabulary is open — e.g. the MCP pack's `mcp.*` dimensions).
 */
export type ScoreDimensionId = ScoreDimension | (string & {});

export interface Score {
  readonly dimension: ScoreDimensionId;
  /** 0..100 */
  readonly value: number;
  readonly evidence: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Session-level records                                              */
/* ------------------------------------------------------------------ */

/** One full pass through the human loop. */
export interface LoopIteration {
  readonly step: number;
  readonly timestamp: number;
  readonly url: string;
  readonly goal: string;
  readonly subgoal: string | null;
  readonly action: Action;
  readonly actionDescription: string;
  readonly rationale: string;
  readonly prediction: Prediction;
  readonly outcome: PredictionOutcome | null;
  /** Snapshot of emotional state *after* the outcome was appraised. */
  readonly emotion: Readonly<Record<string, number>>;
  readonly screenshotIndex: number | null;
  readonly clickPoint: Point | null;
  /** Stable structural identity of the decision-time screen (memory key). */
  readonly stableKey?: string;
  /** Sensitive semantic state of the decision-time screen (attribution key). */
  readonly sensitiveKey?: string;
}

export interface SessionUsage {
  readonly steps: number;
  readonly durationMs: number;
  readonly screensVisited: number;
  readonly uniqueUrls: number;
}
