import type { KernelAction, KernelPercept } from "../core/kernel.js";
import type { Percept, Point, Viewport } from "../core/types.js";
import type { Persona } from "../personas/persona.js";
import type { SurfaceCapabilities } from "../surface/capabilities.js";

/**
 * Browser adapter contract.
 *
 * Adapters are deliberately dumb: they perceive and they actuate. Every
 * decision — where to click, what to type, when to wait — belongs to the
 * cognition engine. An adapter must not expose privileged information; the
 * snapshot it returns is limited to what a human could see.
 */

/** What the adapter reports about the current screen (pre-Percept). */
export interface RawSnapshot {
  url: string;
  title: string;
  viewport: Viewport;
  scrollY: number;
  scrollHeight: number;
  elements: Percept["elements"];
  dialogs: Percept["dialogs"];
  loadingIndicator: boolean;
}

/**
 * Concrete physical measurements of a surface that `SurfaceCapabilities`
 * deliberately doesn't carry — capabilities describe a *kind* of surface
 * shared across many adapters/devices; these numbers are specific to one
 * device and would force a bespoke capabilities object per phone model.
 */
export interface DeviceMetrics {
  /**
   * Height, in CSS pixels, of the band at the bottom of the viewport a soft
   * keyboard covers while a text input has focus. Headless browsers render
   * no real IME, so this is a modeled approximation of the device's on-screen
   * keyboard, not something perceived from the page.
   */
  readonly softKeyboardHeightPx: number;
}

export interface BrowserAdapter {
  readonly name: string;

  /** Which perceptual dimensions this surface actually has. */
  readonly capabilities: SurfaceCapabilities;

  /** Physical measurements of this surface, when it has any worth modeling. */
  readonly deviceMetrics?: DeviceMetrics;

  /**
   * Optional: told which operator is about to use this surface, before
   * {@link open}. Almost no surface cares — a page renders identically for
   * everyone, and *how* the operator reacts to it is cognition's business,
   * not the adapter's. A document surface is the exception: comprehension
   * is a property of the reader as much as of the text, so the adapter needs
   * the persona to report what this reader actually perceived.
   *
   * Adapters that implement it must stay dumb in the usual sense: the
   * persona may shape what is *perceivable*, never what gets decided.
   */
  attachOperator?(persona: Persona): void;

  /** Launch/attach and navigate to the starting URL. */
  open(url: string, viewport: Viewport): Promise<void>;

  /** Capture the current human-visible state of the page. */
  snapshot(): Promise<RawSnapshot>;

  /** PNG screenshot of the viewport, or null if unsupported. */
  screenshot(): Promise<Buffer | null>;

  /** Move the pointer to a viewport point (visible cursor travel). */
  moveMouse(point: Point): Promise<void>;

  /** Press the primary button at a viewport point. */
  clickAt(point: Point): Promise<void>;

  /** Double-click at a viewport point. */
  doubleClickAt(point: Point): Promise<void>;

  /** Type text into whatever currently has focus, one keystroke at a time. */
  typeText(text: string, perCharIntervalMs: number): Promise<void>;

  /** Press a named key (Enter, Tab, Escape, ArrowDown, ...). */
  pressKey(key: string): Promise<void>;

  /** Scroll the window vertically by deltaY CSS pixels. */
  scrollBy(deltaY: number): Promise<void>;

  /** Browser back button. */
  goBack(): Promise<void>;

  /** Navigate the URL bar. */
  navigate(url: string): Promise<void>;

  close(): Promise<void>;
}

/** Options shared by the shipped adapters. */
export interface AdapterOptions {
  headless?: boolean;
  /** Extra ms to wait after navigation for the page to settle. */
  settleMs?: number;
  /** Device to emulate (mobile adapter only), e.g. "iPhone 14". */
  device?: string;
}

/** Adapters are not browser-specific; this alias names the general contract. */
export type SurfaceAdapter = BrowserAdapter;

/**
 * Phase 2: a kernel-native surface (`src/core/kernel.ts`).
 *
 * Kernel-native adapters perceive and actuate in the modality-variant kernel
 * directly, and derive their legacy {@link RawSnapshot} from the kernel
 * percept — the deprecated web view — so old consumers keep working. The
 * session prefers this interface when present: cognition receives the real
 * kernel percept (typed affordances, typed signals) and its `invoke` actions
 * execute through {@link KernelSurface.actKernel} as single semantic acts.
 */
export interface KernelSurface {
  /** The current operator-visible state, in kernel form. */
  kernelPercept(): Promise<KernelPercept>;
  /**
   * Perform one kernel-native action (verb from the surface's declared
   * `capabilities.actionVerbs`). Unknown verbs are a cognition bug and may
   * throw.
   */
  actKernel(action: KernelAction): Promise<void>;
}

/** Narrow an adapter to its kernel-native interface, when it has one. */
export function asKernelSurface(adapter: BrowserAdapter): (BrowserAdapter & KernelSurface) | null {
  const candidate = adapter as Partial<KernelSurface>;
  if (typeof candidate.kernelPercept === "function" && typeof candidate.actKernel === "function") {
    return adapter as BrowserAdapter & KernelSurface;
  }
  return null;
}
