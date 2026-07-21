import type { Percept, Point, Viewport } from "../core/types.js";

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

export interface BrowserAdapter {
  readonly name: string;

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
}
