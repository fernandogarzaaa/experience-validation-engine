import type { Point, Viewport, VisibleElement } from "../core/types.js";
import type { BrowserAdapter, RawSnapshot } from "./adapter.js";
import { VISUAL_SURFACE } from "../surface/capabilities.js";

/**
 * MockAdapter — an in-memory simulated application.
 *
 * Serves three purposes:
 *  1. Deterministic unit/integration tests of the whole engine without a
 *     real browser.
 *  2. Offline demos (`eve run mock:`) so users can watch a full simulation
 *     without installing Playwright.
 *  3. A reference for adapter authors: it implements the exact contract.
 *
 * A mock app is a graph of screens; clicking an element whose `goto` matches
 * a screen id navigates there. Elements are laid out automatically in rows.
 */

export interface MockElementSpec {
  role?: VisibleElement["role"];
  text: string;
  goto?: string;
  editable?: boolean;
  disabled?: boolean;
  /** Shown only after this element receives typed input. */
  onTypeReveal?: string;
  color?: string;
  backgroundColor?: string;
  fontSize?: number;
  width?: number;
  height?: number;
}

export interface MockScreenSpec {
  id: string;
  title: string;
  elements: MockElementSpec[];
  /** Extra screen-load latency in virtual ms. */
  latencyMs?: number;
}

export interface MockAppSpec {
  name: string;
  start: string;
  screens: MockScreenSpec[];
}

/** A small but realistic demo app: landing → login → dashboard → settings. */
export const DEMO_APP: MockAppSpec = {
  name: "Acme Notes",
  start: "landing",
  screens: [
    {
      id: "landing",
      title: "Acme Notes — Simple note taking",
      elements: [
        { role: "heading", text: "Acme Notes" },
        { role: "text", text: "The simplest way to capture your ideas, wherever you are." },
        { role: "button", text: "Get started", goto: "signup" },
        { role: "link", text: "Log in", goto: "login" },
        { role: "link", text: "Pricing", goto: "pricing" },
      ],
    },
    {
      id: "login",
      title: "Log in — Acme Notes",
      elements: [
        { role: "heading", text: "Welcome back" },
        { role: "textbox", text: "Email address", editable: true },
        { role: "textbox", text: "Password", editable: true },
        { role: "button", text: "Log in", goto: "dashboard" },
        { role: "link", text: "Forgot password?", goto: "forgot" },
      ],
    },
    {
      id: "forgot",
      title: "Reset password — Acme Notes",
      elements: [
        { role: "heading", text: "Reset your password" },
        { role: "textbox", text: "Email address", editable: true },
        { role: "button", text: "Send reset link", goto: "forgot-sent" },
        { role: "link", text: "Back to log in", goto: "login" },
      ],
    },
    {
      id: "forgot-sent",
      title: "Check your email — Acme Notes",
      elements: [
        { role: "heading", text: "Check your email" },
        { role: "text", text: "We sent a reset link to your email address." },
        { role: "link", text: "Back to log in", goto: "login" },
      ],
    },
    {
      id: "signup",
      title: "Sign up — Acme Notes",
      elements: [
        { role: "heading", text: "Create your account" },
        { role: "textbox", text: "Full name", editable: true },
        { role: "textbox", text: "Email address", editable: true },
        { role: "textbox", text: "Password", editable: true },
        { role: "button", text: "Create account", goto: "dashboard" },
        { role: "link", text: "Log in instead", goto: "login" },
      ],
    },
    {
      id: "pricing",
      title: "Pricing — Acme Notes",
      elements: [
        { role: "heading", text: "Pricing" },
        { role: "text", text: "Free forever for personal use. Teams from $4 per user." },
        // Deliberately flawed copy so demo runs surface real findings:
        // shouty caps + jargon + tiny low-contrast text.
        {
          role: "text",
          text: "SYNC EVERYTHING VIA THE WEBHOOK API TOKEN",
          fontSize: 9,
          color: "#c7c7c7",
          backgroundColor: "#ffffff",
        },
        { role: "button", text: "Get started", goto: "signup" },
        { role: "link", text: "Home", goto: "landing" },
      ],
    },
    {
      id: "dashboard",
      title: "Your notes — Acme Notes",
      latencyMs: 600,
      elements: [
        { role: "heading", text: "Your notes" },
        { role: "button", text: "New note", goto: "editor" },
        { role: "listitem", text: "Meeting notes — Monday standup" },
        { role: "listitem", text: "Ideas for the offsite" },
        { role: "textbox", text: "Search notes", editable: true },
        { role: "link", text: "Settings", goto: "settings" },
        { role: "button", text: "Export all", goto: "export" },
      ],
    },
    {
      id: "editor",
      title: "New note — Acme Notes",
      elements: [
        { role: "heading", text: "New note" },
        { role: "textbox", text: "Title", editable: true },
        { role: "textbox", text: "Write something…", editable: true },
        { role: "button", text: "Save", goto: "dashboard" },
        { role: "button", text: "Delete", goto: "dashboard" },
        { role: "link", text: "Back", goto: "dashboard" },
      ],
    },
    {
      id: "settings",
      title: "Settings — Acme Notes",
      elements: [
        { role: "heading", text: "Settings" },
        { role: "checkbox", text: "Email notifications" },
        { role: "checkbox", text: "Dark mode" },
        { role: "button", text: "Save changes", goto: "settings" },
        { role: "link", text: "Back to notes", goto: "dashboard" },
      ],
    },
    {
      id: "export",
      title: "Export — Acme Notes",
      elements: [
        { role: "heading", text: "Export your notes" },
        { role: "button", text: "Download .zip", goto: "dashboard" },
        { role: "link", text: "Back", goto: "dashboard" },
      ],
    },
  ],
};

export class MockAdapter implements BrowserAdapter {
  readonly name = "mock";
  /** Visual/spatial like a real browser, but never produces a screenshot. */
  readonly capabilities = { ...VISUAL_SURFACE, canScreenshot: false } as const;
  private readonly app: MockAppSpec;
  private currentId: string;
  private history: string[] = [];
  private viewport: Viewport = { width: 1280, height: 800 };
  private scrollY = 0;
  private typedInto = new Set<string>();
  private focusedIndex = -1;
  private opened = false;

  constructor(app: MockAppSpec = DEMO_APP) {
    this.app = app;
    this.currentId = app.start;
    for (const screen of app.screens) {
      for (const el of screen.elements) {
        if (el.goto && !app.screens.some((s) => s.id === el.goto)) {
          throw new Error(`Mock app "${app.name}": screen "${screen.id}" links to unknown screen "${el.goto}"`);
        }
      }
    }
  }

  async open(url: string, viewport: Viewport): Promise<void> {
    this.viewport = viewport;
    this.opened = true;
    const target = url.replace(/^mock:\/*/, "");
    if (target && this.app.screens.some((s) => s.id === target)) this.currentId = target;
    this.history = [this.currentId];
  }

  async snapshot(): Promise<RawSnapshot> {
    if (!this.opened) throw new Error("MockAdapter: call open() first");
    const screen = this.screen();
    const elements = this.layout(screen);
    return {
      url: `mock://${this.app.name.toLowerCase().replace(/\s+/g, "-")}/${screen.id}`,
      title: screen.title,
      viewport: this.viewport,
      scrollY: this.scrollY,
      scrollHeight: Math.max(this.viewport.height, elements.length * 72 + 120),
      elements,
      dialogs: [],
      loadingIndicator: false,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    return null; // The mock world has no pixels.
  }

  async moveMouse(): Promise<void> {}

  async clickAt(point: Point): Promise<void> {
    const screen = this.screen();
    const elements = this.layout(screen);
    const hit = elements.find(
      (el) =>
        point.x >= el.box.x &&
        point.x <= el.box.x + el.box.width &&
        point.y >= el.box.y &&
        point.y <= el.box.y + el.box.height,
    );
    if (!hit) return;
    this.focusedIndex = hit.id;
    const spec = screen.elements[hit.id];
    if (spec?.goto && !spec.disabled) this.go(spec.goto);
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.clickAt(point);
  }

  async typeText(text: string): Promise<void> {
    const screen = this.screen();
    const spec = screen.elements[this.focusedIndex];
    if (spec?.editable) this.typedInto.add(`${screen.id}:${this.focusedIndex}`);
    void text;
  }

  async pressKey(key: string): Promise<void> {
    const screen = this.screen();
    if (key === "Tab") {
      const interactiveIdxs = screen.elements
        .map((el, i) => ({ el, i }))
        .filter(({ el }) => !el.disabled && (el.editable || el.goto || el.role === "button" || el.role === "link" || el.role === "checkbox"))
        .map(({ i }) => i);
      if (interactiveIdxs.length === 0) return;
      const pos = interactiveIdxs.indexOf(this.focusedIndex);
      this.focusedIndex = interactiveIdxs[(pos + 1) % interactiveIdxs.length]!;
    } else if (key === "Enter") {
      const spec = screen.elements[this.focusedIndex];
      if (spec?.goto && !spec.disabled) this.go(spec.goto);
    }
  }

  async scrollBy(deltaY: number): Promise<void> {
    const snap = await this.snapshot();
    this.scrollY = Math.max(0, Math.min(snap.scrollHeight - this.viewport.height, this.scrollY + deltaY));
  }

  async goBack(): Promise<void> {
    if (this.history.length > 1) {
      this.history.pop();
      this.currentId = this.history[this.history.length - 1]!;
      this.scrollY = 0;
      this.focusedIndex = -1;
    }
  }

  async navigate(url: string): Promise<void> {
    const target = url.replace(/^mock:\/*/, "").split("/").pop() ?? "";
    if (this.app.screens.some((s) => s.id === target)) this.go(target);
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  /* ---------------------------------------------------------------- */

  private go(id: string): void {
    this.currentId = id;
    this.history.push(id);
    this.scrollY = 0;
    this.focusedIndex = -1;
  }

  private screen(): MockScreenSpec {
    const screen = this.app.screens.find((s) => s.id === this.currentId);
    if (!screen) throw new Error(`Mock app: unknown screen "${this.currentId}"`);
    return screen;
  }

  /** Simple single-column layout; positions are viewport-relative. */
  private layout(screen: MockScreenSpec): VisibleElement[] {
    const out: VisibleElement[] = [];
    let y = 60 - this.scrollY;
    screen.elements.forEach((spec, index) => {
      const role = spec.role ?? "text";
      const height = spec.height ?? (role === "heading" ? 48 : role === "textbox" ? 40 : 36);
      const width = spec.width ?? Math.min(this.viewport.width - 120, role === "heading" ? 600 : 420);
      const typed = this.typedInto.has(`${screen.id}:${index}`);
      out.push({
        id: index,
        role,
        text: typed && spec.editable ? `${spec.text} (filled)` : spec.text,
        box: { x: 60, y, width, height },
        interactive: !!spec.goto || !!spec.editable || role === "button" || role === "link" || role === "checkbox" || role === "tab",
        disabled: spec.disabled ?? false,
        editable: spec.editable ?? false,
        focused: index === this.focusedIndex,
        clippedByViewport: false,
        color: spec.color ?? "#1f2430",
        backgroundColor: spec.backgroundColor ?? "#ffffff",
        fontSize: spec.fontSize ?? (role === "heading" ? 28 : 15),
      });
      y += height + 24;
    });
    return out;
  }
}
