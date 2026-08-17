/**
 * The modality-variant kernel (Phase 2, Approach B — the one-time core
 * generalization; see `docs/kernel.md` and `docs/projection-debt-ledger.md`).
 *
 * Everything downstream of the adapters actually consumes five things, and
 * they are all modality-agnostic:
 *
 * | Kernel concept     | Browser-flavored legacy form                          |
 * | ------------------ | ----------------------------------------------------- |
 * | frame identity     | `Percept.url` / `Percept.title`                       |
 * | affordances        | `VisibleElement[]` (ARIA-flavored role + pixel box)   |
 * | surface signals    | `dialogs` + `loadingIndicator` + scroll extent        |
 * | action vocabulary  | the closed 11-kind `Action` union                     |
 * | outcome            | next percept + prediction comparison (unchanged)    |
 *
 * The kernel names those five concepts directly: {@link KernelPercept} is a
 * discriminated union over modality; {@link Affordance.kind} is an open,
 * registry-aligned string (ARIA roles on the web, `mcp.tool` on MCP), not a
 * closed union; {@link SurfaceSignal} is typed, so a tool result, a protocol
 * error and a server notification are three different things rather than one
 * fake "dialog"; and {@link KernelAction.verb} comes from the per-surface
 * verb registry the adapter declares in `SurfaceCapabilities.actionVerbs`.
 *
 * The legacy `Percept`/`Action` shapes are NOT removed. They are the
 * deprecated **web view** of the kernel: `kernelFromWebPercept` projects a
 * legacy percept into the kernel, and `webPerceptFromKernel` projects a
 * kernel percept back. Adapters that predate the kernel (browser, CLI, mock)
 * keep shipping the legacy shape and are projected; kernel-native adapters
 * (MCP) ship the real thing and derive their legacy snapshot from it, so old
 * consumers keep working while the strain entries in the projection debt
 * ledger get first-class homes here.
 */

import type { Modality } from "./registry.js";
import type { BoundingBox, Percept, Viewport } from "./types.js";

/* ------------------------------------------------------------------ */
/* Frame identity                                                      */
/* ------------------------------------------------------------------ */

/**
 * Where the operator is, independent of "page/URL". A URL, a command line,
 * an `mcp:<target>` server address — anything an operator could read off
 * the surface's own chrome.
 */
export interface FrameIdentity {
  /** The operator-visible address (URL bar, command line, server target). */
  readonly address: string;
  /** The operator-visible label (tab title, command, server name). */
  readonly label: string;
  /**
   * Adapter-declared sub-state of the surface ("menu" / "form" / "result"
   * on MCP). The ledger's item 5: three perceptually distinct states used
   * to share one URL; the kernel names the state explicitly.
   */
  readonly surfaceState?: string;
}

/* ------------------------------------------------------------------ */
/* Affordances                                                         */
/* ------------------------------------------------------------------ */

/**
 * Where an affordance lives, in the surface's own geometry: pixel boxes on
 * visual surfaces, character cells on text surfaces, schema paths on tool
 * surfaces.
 */
export type AffordanceLocator =
  | { readonly kind: "bbox"; readonly box: BoundingBox }
  | { readonly kind: "charCell"; readonly line: number; readonly column: number }
  | { readonly kind: "schemaPath"; readonly path: string };

/**
 * One thing the operator can act on.
 *
 * `kind` is deliberately an open string, aligned with the Phase-0
 * registries rather than a closed union: web adapters emit ARIA-flavored
 * perceptual roles (`button`, `textbox`, … — the legacy `PerceivedRole`
 * vocabulary), the MCP adapter emits `mcp.tool`. New surfaces mint kinds
 * alongside their verb registrations instead of editing core.
 */
export interface Affordance {
  /**
   * Adapter-assigned identity. Stable across frames while the underlying
   * entity persists (an MCP tool keeps `tool:<name>` across a
   * `list_changed` refresh — positional identity was ledger item 2).
   */
  readonly id: string;
  readonly kind: string;
  readonly locator: AffordanceLocator;
  /** What the operator reads about it (label text, tool description). */
  readonly description: string;
  readonly state: {
    readonly enabled: boolean;
    readonly editable?: boolean;
    /**
     * Perceived metadata the surface itself advertises — a tool's JSON
     * Schema and annotations on MCP. Never privileged information: only
     * what a legitimate user of the surface could read.
     */
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
}

/* ------------------------------------------------------------------ */
/* Surface signals                                                     */
/* ------------------------------------------------------------------ */

/**
 * A typed event the surface presents. The legacy web view had exactly two
 * slots (dialogs, loading indicator), which forced MCP results, errors and
 * notifications through one fake "dialog" metaphor (ledger item 3). Here
 * each is its own type.
 */
export type SurfaceSignal =
  /** A modal overlay visibly blocking the surface (real dialogs only). */
  | { readonly type: "dialog"; readonly text: string }
  /** A visible busy indicator (spinner, skeleton, in-flight call). */
  | { readonly type: "loading"; readonly active: boolean }
  /**
   * A failure presented to the operator. `source` distinguishes a tool
   * rejecting a call, the protocol rejecting a request, and the surface
   * itself failing — three things the dialog metaphor conflated.
   */
  | {
      readonly type: "error";
      readonly text: string;
      readonly source: "tool" | "protocol" | "surface";
    }
  /**
   * The outcome of a tool invocation, in full. `truncated` reports whether
   * the *legacy web view* shortened it for display; the kernel signal
   * always carries the complete operator-visible text (ledger item 3's
   * truncation loss is explicit, not silent).
   */
  | {
      readonly type: "tool-result";
      readonly tool: string;
      readonly isError: boolean;
      readonly text: string;
      readonly truncated: boolean;
    }
  /** An asynchronous server notice (e.g. `notifications/tools/list_changed`). */
  | { readonly type: "notification"; readonly method: string }
  /** The surface is waiting for the operator's input (a prompt). */
  | { readonly type: "await-input"; readonly prompt: string }
  /**
   * The surface itself ceased to exist (server died, process exited) —
   * distinct from "this screen has no affordances" (ledger item 6).
   */
  | { readonly type: "surface-terminated"; readonly reason: string };

/* ------------------------------------------------------------------ */
/* Kernel percept                                                      */
/* ------------------------------------------------------------------ */

interface KernelPerceptBase {
  /** Milliseconds since session start. */
  readonly timestamp: number;
  readonly frame: FrameIdentity;
  readonly affordances: readonly Affordance[];
  readonly signals: readonly SurfaceSignal[];
}

/** A visual surface: pixel geometry and a screenshot when available. */
export interface VisualKernelPercept extends KernelPerceptBase {
  readonly modality: "visual";
  readonly viewport: Viewport;
  readonly scrollY: number;
  readonly scrollHeight: number;
  readonly screenshot: Buffer | null;
}

/** A textual surface: the operator-visible lines and the viewing window. */
export interface TextualKernelPercept extends KernelPerceptBase {
  readonly modality: "textual";
  readonly lines: readonly string[];
  readonly windowRows: number;
  readonly scrollLine: number;
}

/**
 * Everything the operator perceives in one glance, in the surface's own
 * modality. Discriminated so modality-specific detail (screenshots, schema)
 * is present exactly where it is meaningful.
 */
export type KernelPercept = VisualKernelPercept | TextualKernelPercept;

/* ------------------------------------------------------------------ */
/* Kernel actions                                                      */
/* ------------------------------------------------------------------ */

/**
 * One semantic act, named by what it is: `verb` comes from the per-surface
 * verb registry the adapter declares in `SurfaceCapabilities.actionVerbs`,
 * and `payload` is typed by the surface (structured tool arguments on MCP —
 * no more text coercion, ledger item 4). A single `tools/call` is a single
 * `mcp.invoke` action, not a form fill plus Enter (ledger item 1).
 */
export interface KernelAction {
  readonly verb: string;
  /** The affordance being acted on, by {@link Affordance.id}, when any. */
  readonly target?: string;
  readonly payload?: unknown;
}

/* ------------------------------------------------------------------ */
/* The deprecated web view (compatibility shims)                       */
/* ------------------------------------------------------------------ */

/**
 * Project a legacy web {@link Percept} into the kernel. The mapping is
 * one-to-one on content (elements → affordances, dialogs/loading → signals,
 * url/title → frame identity); the returned kernel percept is what cognition
 * sees when the adapter predates the kernel, so kernel-aware consumers work
 * uniformly across old and new adapters.
 *
 * `modality` comes from the adapter's `SurfaceCapabilities`. For textual
 * legacy adapters (CLI) the projection is honest about its limits: the
 * kernel affordances and signals are complete, but the line buffer is empty
 * — a legacy `Percept` simply does not carry one.
 */
export function kernelFromWebPercept(
  percept: Percept,
  modality: Modality = "visual",
): KernelPercept {
  const affordances: Affordance[] = percept.elements.map((el) => ({
    id: `el:${el.id}`,
    kind: el.role,
    locator: { kind: "bbox", box: el.box },
    description: el.text,
    state: {
      enabled: !el.disabled,
      editable: el.editable,
    },
  }));
  const signals: SurfaceSignal[] = percept.dialogs.map((d) => ({ type: "dialog", text: d.text }));
  if (percept.loadingIndicator) signals.push({ type: "loading", active: true });
  const base = {
    timestamp: percept.timestamp,
    frame: { address: percept.url, label: percept.title },
    affordances,
    signals,
  };
  if (modality === "textual") {
    return {
      ...base,
      modality,
      // A legacy Percept carries no line buffer to project.
      lines: [],
      windowRows: 0,
      scrollLine: 0,
    };
  }
  return {
    ...base,
    modality,
    viewport: percept.viewport,
    scrollY: percept.scrollY,
    scrollHeight: percept.scrollHeight,
    screenshot: percept.screenshot,
  };
}

/**
 * Project a kernel percept back into the deprecated web view.
 *
 * For visual kernel percepts this is the inverse of
 * {@link kernelFromWebPercept} (round-trip preserves identity/geometry).
 * Textual kernels need char-cell layout, which lives in the surface layer —
 * see `webPerceptFromKernel` in `src/surface/kernelView.ts`, the full
 * `WebPerceptView` entry point.
 */
export function webPerceptFromVisualKernel(percept: VisualKernelPercept): Percept {
  return {
    timestamp: percept.timestamp,
    url: percept.frame.address,
    title: percept.frame.label,
    viewport: percept.viewport,
    scrollY: percept.scrollY,
    scrollHeight: percept.scrollHeight,
    screenshot: percept.screenshot,
    elements: percept.affordances.map((a, index) => {
      const box = a.locator.kind === "bbox" ? a.locator.box : { x: 0, y: 0, width: 0, height: 0 };
      return {
        id: index,
        role: isPerceivedRoleLike(a.kind) ? a.kind : "unknown",
        text: a.description,
        box,
        interactive: a.state.enabled,
        disabled: !a.state.enabled,
        editable: a.state.editable ?? false,
        focused: false,
        clippedByViewport: false,
      };
    }),
    dialogs: percept.signals
      .filter((s): s is Extract<SurfaceSignal, { type: "dialog" }> => s.type === "dialog")
      .map((s) => ({ text: s.text, box: null })),
    loadingIndicator: percept.signals.some((s) => s.type === "loading" && s.active),
  };
}

/** The open affordance-kind vocabulary overlaps the legacy ARIA roles. */
function isPerceivedRoleLike(kind: string): kind is Percept["elements"][number]["role"] {
  return PERCEIVED_ROLE_LIKE.has(kind);
}

const PERCEIVED_ROLE_LIKE: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "select",
  "slider",
  "tab",
  "menuitem",
  "image",
  "heading",
  "text",
  "listitem",
  "dialog",
  "alert",
  "progress",
  "table",
  "unknown",
]);

/** Modality helper re-exported for kernel consumers. */
export type { Modality } from "./registry.js";
