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
  | { readonly kind: "schemaPath"; readonly path: string }
  /**
   * A position in a document's reading order: which section/page/slide, and
   * how far into it. A reader does not point at pixels or cells — they are
   * "in the third paragraph of section 2" — and that is the geometry a
   * document surface actually has (`src/humanity/`).
   */
  | { readonly kind: "readingOrder"; readonly section: number; readonly block: number }
  /**
   * A position in a dialogue: which turn, counting from the opening. A
   * conversational surface has no page and no cell — the only place a thing
   * can be is "in the reply three turns ago" (`src/conversation/`).
   */
  | { readonly kind: "turn"; readonly index: number };

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
  | { readonly type: "surface-terminated"; readonly reason: string }
  /**
   * The reader reached the end of a document surface. A document ends; a
   * page and a tool catalog do not, and conflating "nothing more to read"
   * with "the surface died" would make a finished read look like a crash.
   */
  | { readonly type: "end-of-content"; readonly label: string }
  /**
   * Something the operator read but did not understand: an undefined term,
   * an unlabeled figure, a number with no baseline. Emitted by the surface
   * because comprehension failure is *perceived* — the reader knows they are
   * lost — where a dialog or an error is something the surface announces.
   */
  /**
   * The surface told the operator it did not understand them — "sorry, I
   * didn't catch that", "can you rephrase?", a fallback intent firing.
   *
   * Every other modality can only fail in one direction: the operator does
   * not understand the surface. A dialogue is the one place the surface can
   * fail to understand *them*, and the operator perceives that failure
   * directly. `confident` marks the worse variant — the surface did not
   * signal any trouble and answered something else entirely, which the
   * operator only discovers by reading the reply.
   */
  | {
      readonly type: "not-understood";
      readonly text: string;
      readonly confident: boolean;
    }
  | {
      readonly type: "comprehension-gap";
      readonly text: string;
      readonly gap: "term" | "reference" | "figure" | "quantity" | "structure";
    };

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
 * One unit of read content: a heading, a paragraph, a bullet, a table, a
 * figure, a metric. `kind` is an open string for the same reason
 * {@link Affordance.kind} is — new artifact formats mint block kinds
 * alongside their readers instead of editing core.
 */
export interface ContentBlock {
  readonly id: string;
  readonly kind: string;
  /** What the eye actually reads. */
  readonly text: string;
  /** Heading level / list nesting, 0 for top-level prose. */
  readonly depth: number;
  /** Index of the section, page or slide this block belongs to. */
  readonly section: number;
  /**
   * Structured content behind the text, when the block has any: table rows,
   * a metric's value and baseline, a figure's alternative text. Perceived,
   * never privileged — it is what the artifact itself puts on the page.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * A document surface: a digital output the operator *reads* — a report, a
 * deck, an analytics export, a terminal transcript, an API response someone
 * has to make sense of.
 *
 * What makes it its own modality rather than a textual surface with extra
 * fields: reading order is the geometry (not rows and columns), content is
 * paginated into sections/slides/pages the reader moves between, and the
 * failure modes are comprehension failures — a term never defined, a figure
 * with no caption, a number with no baseline — not click targets that miss.
 */
export interface DocumentKernelPercept extends KernelPerceptBase {
  readonly modality: "document";
  /** The blocks currently in view, in reading order. */
  readonly blocks: readonly ContentBlock[];
  /** Index of the section/page/slide in view. */
  readonly section: number;
  /** How many sections the artifact has in total. */
  readonly sectionCount: number;
  /** Human-readable name for one unit: "page", "slide", "section", "screen". */
  readonly sectionNoun: string;
  /** Total blocks in the whole artifact — how much is left to read. */
  readonly totalBlocks: number;
  /** Blocks the operator has already read, across the whole artifact. */
  readonly blocksRead: number;
}

/** Who spoke. A dialogue has exactly two sides from the operator's view. */
export type Speaker = "operator" | "surface";

/** One thing that was said, by either side. */
export interface ConversationTurn {
  readonly id: string;
  readonly speaker: Speaker;
  readonly text: string;
  /**
   * How long the operator waited for this turn to appear, in ms. Present
   * only on surface turns: latency is something the operator *endures*, and
   * it is the difference between a considered answer and a dead interface.
   */
  readonly latencyMs?: number;
  /**
   * What the surface offered alongside the text — suggested replies,
   * citations, a handoff button. Perceived, never privileged: only what a
   * user of the surface could see.
   */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * A conversational surface: something that answers back. A support bot, an
 * LLM copilot, a voice assistant, an in-product "ask me anything".
 *
 * It is not a document that happens to arrive in pieces. Three things make
 * it its own modality: turn order is the geometry (there is no page to
 * scroll and no cell to point at); the operator *waits*, without knowing
 * whether anything is happening; and it is the only surface that can fail to
 * understand the operator, who then has to decide whether to rephrase, give
 * up on the phrasing, or give up on the surface.
 */
export interface ConversationalKernelPercept extends KernelPerceptBase {
  readonly modality: "conversational";
  /** Every turn so far, oldest first. */
  readonly turns: readonly ConversationTurn[];
  /**
   * How many of the most recent turns the operator still has in mind. A
   * dialogue scrolls out of memory the way a page scrolls off screen.
   */
  readonly recallWindow: number;
  /** The surface is composing a reply right now. */
  readonly awaitingReply: boolean;
  /** How long the operator waited for the latest reply, in ms. */
  readonly lastLatencyMs: number | null;
  /**
   * Times the operator has had to say the same thing again, in any phrasing.
   * The count that decides whether a person tries once more or leaves.
   */
  readonly repairAttempts: number;
}

/**
 * Everything the operator perceives in one glance, in the surface's own
 * modality. Discriminated so modality-specific detail (screenshots, schema,
 * reading position, turn history) is present exactly where it is meaningful.
 */
export type KernelPercept =
  | VisualKernelPercept
  | TextualKernelPercept
  | DocumentKernelPercept
  | ConversationalKernelPercept;

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
  if (modality === "conversational") {
    // A legacy Percept has no turn history to project: the best it can do is
    // present the whole screen as one thing the surface said.
    const text = percept.elements
      .map((el) => el.text.trim())
      .filter(Boolean)
      .join("\n");
    return {
      ...base,
      modality,
      turns: text ? [{ id: "t0", speaker: "surface" as const, text }] : [],
      recallWindow: 1,
      awaitingReply: percept.loadingIndicator,
      lastLatencyMs: null,
      repairAttempts: 0,
    };
  }
  if (modality === "document") {
    // A legacy Percept has no reading order, so the projection is honest
    // about that: every visible element becomes one block of the single
    // section the web view can express.
    return {
      ...base,
      modality,
      blocks: percept.elements.map((el) => ({
        id: `el:${el.id}`,
        kind: el.role,
        text: el.text,
        depth: 0,
        section: 0,
      })),
      section: 0,
      sectionCount: 1,
      sectionNoun: "section",
      totalBlocks: percept.elements.length,
      blocksRead: 0,
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
