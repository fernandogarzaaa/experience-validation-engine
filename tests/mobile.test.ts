import { describe, expect, it } from "vitest";
import type { BrowserAdapter, RawSnapshot } from "../src/browser/adapter.js";
import {
  planClick,
  planSoftKeyType,
  planSwipe,
  planTap,
  planTyping,
} from "../src/browser/humanizer.js";
import { MockAdapter } from "../src/browser/mock.js";
import { createRng } from "../src/core/random.js";
import type {
  Finding,
  LoopIteration,
  Percept,
  Point,
  Viewport,
  VisibleElement,
} from "../src/core/types.js";
import { EveSession } from "../src/engine/session.js";
import { Observer } from "../src/observation/perception.js";
import { getPersona } from "../src/personas/index.js";
import { AccessibilityPlugin } from "../src/plugins/accessibility.js";
import type { SurfaceCapabilities } from "../src/surface/capabilities.js";
import { TOUCH_VISUAL_SURFACE, VISUAL_SURFACE } from "../src/surface/capabilities.js";

/* ------------------------------------------------------------------ */
/* Shared fixtures                                                     */
/* ------------------------------------------------------------------ */

function element(overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: 0,
    role: "button",
    text: "Save",
    box: { x: 40, y: 500, width: 300, height: 200 },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(overrides: Partial<Percept> = {}): Percept {
  return {
    timestamp: 0,
    url: "https://app.example/screen",
    title: "Screen",
    viewport: { width: 375, height: 812 },
    scrollY: 0,
    scrollHeight: 1200,
    screenshot: null,
    elements: [element()],
    dialogs: [],
    loadingIndicator: false,
    ...overrides,
  };
}

function context(capabilities: SurfaceCapabilities) {
  const findings: Finding[] = [];
  const persona = { accessibility: { keyboardOnly: false } };
  return {
    findings,
    ctx: { capabilities, persona, report: (f: Finding) => findings.push(f) },
  };
}

function loopIteration(overrides: Partial<LoopIteration> = {}): LoopIteration {
  return {
    step: 0,
    timestamp: 0,
    url: "https://app.example/screen",
    goal: "explore",
    subgoal: null,
    action: { kind: "press", key: "Tab" },
    actionDescription: "",
    rationale: "",
    prediction: { description: "", expectedSignals: [], expectsChange: false, confidence: 0.5 },
    outcome: null,
    emotion: {},
    screenshotIndex: null,
    clickPoint: null,
    ...overrides,
  };
}

function fakeAdapter(
  snap: RawSnapshot,
  opts: { touch?: boolean; softKeyboardHeightPx?: number } = {},
): BrowserAdapter {
  return {
    name: "fake",
    capabilities: opts.touch ? TOUCH_VISUAL_SURFACE : VISUAL_SURFACE,
    deviceMetrics: opts.touch
      ? { softKeyboardHeightPx: opts.softKeyboardHeightPx ?? 336 }
      : undefined,
    snapshot: async () => snap,
    screenshot: async () => null,
  } as unknown as BrowserAdapter;
}

/* ------------------------------------------------------------------ */
/* Touch scatter                                                       */
/* ------------------------------------------------------------------ */

describe("touch scatter", () => {
  it("scatters taps materially wider than mouse clicks for the same target and persona", () => {
    const target = element({ box: { x: 40, y: 500, width: 300, height: 200 } });
    const viewport = { width: 375, height: 812 };
    const persona = getPersona("office-worker");
    const rngClick = createRng(5);
    const rngTap = createRng(5);
    const N = 300;
    const clickXs: number[] = [];
    const tapXs: number[] = [];
    for (let i = 0; i < N; i++) {
      clickXs.push(planClick(target, persona, rngClick).point.x);
      tapXs.push(planTap(target, persona, rngTap, viewport).point.x);
    }
    const variance = (xs: number[]) => {
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    };
    expect(variance(tapXs)).toBeGreaterThan(variance(clickXs));
  });

  it("taps land near the target and always carry positive duration", () => {
    const target = element();
    const viewport = { width: 375, height: 812 };
    const persona = getPersona("office-worker");
    const rng = createRng(11);
    for (let i = 0; i < 50; i++) {
      const gesture = planTap(target, persona, rng, viewport);
      expect(gesture.durationMs).toBeGreaterThan(0);
      expect(gesture.point.x).toBeGreaterThanOrEqual(target.box.x);
      expect(gesture.point.x).toBeLessThanOrEqual(target.box.x + target.box.width);
    }
  });

  it("low-accuracy personas miss small targets by tap more than by click", () => {
    const tiny = element({ box: { x: 100, y: 700, width: 18, height: 14 } });
    const viewport = { width: 375, height: 812 };
    const elderly = getPersona("elderly-user");
    const rngClick = createRng(2);
    const rngTap = createRng(2);
    let clickMisses = 0;
    let tapMisses = 0;
    for (let i = 0; i < 200; i++) {
      if (planClick(tiny, elderly, rngClick).missed) clickMisses += 1;
      if (planTap(tiny, elderly, rngTap, viewport).missed) tapMisses += 1;
    }
    expect(tapMisses).toBeGreaterThan(clickMisses);
  });
});

/* ------------------------------------------------------------------ */
/* Swipe momentum                                                      */
/* ------------------------------------------------------------------ */

describe("swipe planning", () => {
  it("plans a swipe as decaying momentum segments that sum to the intended distance", () => {
    const rng = createRng(9);
    const persona = getPersona("first-time-user");
    const plan = planSwipe(600, persona, rng);
    expect(plan.segments.length).toBeGreaterThanOrEqual(3);
    const total = plan.segments.reduce((sum, s) => sum + s.deltaY, 0);
    expect(total).toBe(600);
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i]!.durationMs).toBeGreaterThan(plan.segments[i - 1]!.durationMs);
    }
  });

  it("advances scrollY when segments are applied in sequence, clamped like a real adapter", () => {
    const rng = createRng(21);
    const persona = getPersona("first-time-user");
    const plan = planSwipe(500, persona, rng);
    let scrollY = 0;
    const scrollHeight = 2000;
    const viewportHeight = 800;
    for (const segment of plan.segments) {
      scrollY = Math.max(0, Math.min(scrollHeight - viewportHeight, scrollY + segment.deltaY));
    }
    expect(scrollY).toBeGreaterThan(0);
  });

  it("plans nothing for a zero-distance scroll", () => {
    const rng = createRng(1);
    const persona = getPersona("first-time-user");
    expect(planSwipe(0, persona, rng).segments).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Soft-keyboard typing                                                */
/* ------------------------------------------------------------------ */

describe("soft-keyboard typing", () => {
  it("types slower and with no fewer typos than a physical keyboard, for the same persona and seed", () => {
    const persona = getPersona("impatient-user");
    const text = "the quick brown fox jumps over the lazy dog ".repeat(6);
    // Same seed on two independent Rngs: both plans consume rng.chance() in
    // lockstep (once per neighbor-keyed character, regardless of typoP), so
    // whichever draws trigger the lower physical-keyboard threshold also
    // trigger the higher soft-keyboard one. The comparison is deterministic,
    // not probabilistic.
    const physical = planTyping(text, persona, createRng(3));
    const soft = planSoftKeyType(text, persona, createRng(3));
    expect(soft.perCharIntervalMs).toBeGreaterThan(physical.perCharIntervalMs);
    expect(soft.typoCount).toBeGreaterThanOrEqual(physical.typoCount);
  });
});

/* ------------------------------------------------------------------ */
/* Keyboard occlusion                                                  */
/* ------------------------------------------------------------------ */

describe("keyboard occlusion", () => {
  it("models an occlusion band and flags elements behind it when a text field has focus", async () => {
    const viewport = { width: 375, height: 812 };
    const snap: RawSnapshot = {
      url: "mock://app/signup",
      title: "Sign up",
      viewport,
      scrollY: 0,
      scrollHeight: 900,
      elements: [
        element({
          id: 0,
          role: "textbox",
          text: "Email",
          box: { x: 20, y: 400, width: 335, height: 44 },
          editable: true,
          focused: true,
        }),
        element({
          id: 1,
          role: "button",
          text: "Submit",
          box: { x: 20, y: 760, width: 335, height: 44 },
          focused: false,
        }),
      ],
      dialogs: [],
      loadingIndicator: false,
    };
    const adapter = fakeAdapter(snap, { touch: true, softKeyboardHeightPx: 336 });
    const { percept: p } = await new Observer(adapter, 0).observe();

    expect(p.keyboardOcclusion).not.toBeNull();
    expect(p.keyboardOcclusion?.height).toBe(336);
    expect(p.keyboardOcclusion?.y).toBe(viewport.height - 336);

    const submit = p.elements.find((el) => el.id === 1);
    expect(submit?.occludedByKeyboard).toBe(true);
    const email = p.elements.find((el) => el.id === 0);
    expect(email?.occludedByKeyboard).toBeUndefined();
  });

  it("has no keyboard occlusion when nothing is focused", async () => {
    const viewport = { width: 375, height: 812 };
    const snap: RawSnapshot = {
      url: "mock://app/landing",
      title: "Landing",
      viewport,
      scrollY: 0,
      scrollHeight: 900,
      elements: [element({ id: 0, editable: true, focused: false })],
      dialogs: [],
      loadingIndicator: false,
    };
    const adapter = fakeAdapter(snap, { touch: true });
    const { percept: p } = await new Observer(adapter, 0).observe();
    expect(p.keyboardOcclusion).toBeNull();
  });

  it("never models keyboard occlusion on a mouse surface", async () => {
    const viewport = { width: 1280, height: 800 };
    const snap: RawSnapshot = {
      url: "https://app.example/signup",
      title: "Sign up",
      viewport,
      scrollY: 0,
      scrollHeight: 900,
      elements: [element({ id: 0, editable: true, focused: true })],
      dialogs: [],
      loadingIndicator: false,
    };
    const adapter = fakeAdapter(snap, { touch: false });
    const { percept: p } = await new Observer(adapter, 0).observe();
    expect(p.keyboardOcclusion).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Accessibility plugin: touch-specific findings                       */
/* ------------------------------------------------------------------ */

describe("accessibility plugin on a touch surface", () => {
  it("flags tap targets under the 44x44px minimum", async () => {
    const { findings, ctx } = context(TOUCH_VISUAL_SURFACE);
    const p = percept({ elements: [element({ box: { x: 10, y: 10, width: 30, height: 30 } })] });
    await new AccessibilityPlugin().onPercept(ctx as never, p);
    expect(findings.some((f) => f.title.includes("tap target"))).toBe(true);
  });

  it("does not flag adequately sized tap targets", async () => {
    const { findings, ctx } = context(TOUCH_VISUAL_SURFACE);
    const p = percept({ elements: [element({ box: { x: 10, y: 10, width: 60, height: 48 } })] });
    await new AccessibilityPlugin().onPercept(ctx as never, p);
    expect(findings.some((f) => f.title.includes("tap target"))).toBe(false);
  });

  it("does not run tap-target checks on a mouse surface", async () => {
    const { findings, ctx } = context(VISUAL_SURFACE);
    const p = percept({ elements: [element({ box: { x: 10, y: 10, width: 30, height: 30 } })] });
    await new AccessibilityPlugin().onPercept(ctx as never, p);
    expect(findings.some((f) => f.title.includes("tap target"))).toBe(false);
  });

  it("flags content covered by the modeled keyboard", async () => {
    const { findings, ctx } = context(TOUCH_VISUAL_SURFACE);
    const p = percept({
      elements: [
        // occludedByKeyboard is set directly: it's the observation layer's
        // output, not something this plugin computes itself.
        element({ box: { x: 10, y: 760, width: 100, height: 44 }, occludedByKeyboard: true }),
      ],
    });
    await new AccessibilityPlugin().onPercept(ctx as never, p);
    expect(findings.some((f) => f.title.includes("keyboard"))).toBe(true);
  });

  it("reports a hover-only affordance finding when hover was attempted on a no-hover surface", async () => {
    const { findings, ctx } = context(TOUCH_VISUAL_SURFACE);
    const target = element({ id: 2, role: "menuitem", text: "More options" });
    const iterations = [loopIteration({ action: { kind: "hover", target } })];
    await new AccessibilityPlugin().onSessionEnd(ctx as never, iterations);
    expect(findings.some((f) => f.title.includes("Hover-only"))).toBe(true);
  });

  it("does not report a hover-only finding on a surface that supports hover", async () => {
    const { findings, ctx } = context(VISUAL_SURFACE);
    const target = element({ id: 2, role: "menuitem", text: "More options" });
    const iterations = [loopIteration({ action: { kind: "hover", target } })];
    await new AccessibilityPlugin().onSessionEnd(ctx as never, iterations);
    expect(findings).toHaveLength(0);
  });

  it("does not report a hover-only finding when hover was never attempted", async () => {
    const { findings, ctx } = context(TOUCH_VISUAL_SURFACE);
    await new AccessibilityPlugin().onSessionEnd(ctx as never, [loopIteration()]);
    expect(findings).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Session-level touch execution path                                  */
/* ------------------------------------------------------------------ */

/**
 * Wraps MockAdapter (a full, working BrowserAdapter over a real screen graph)
 * but declares touch capabilities and records every call, so a real
 * EveSession.run() can exercise engine.ts's touch branches end to end without
 * a real browser.
 */
class RecordingTouchAdapter implements BrowserAdapter {
  readonly name = "mock";
  readonly capabilities = TOUCH_VISUAL_SURFACE;
  readonly deviceMetrics = { softKeyboardHeightPx: 300 };
  readonly calls: string[] = [];
  private readonly inner = new MockAdapter();

  async open(url: string, viewport: Viewport): Promise<void> {
    this.calls.push("open");
    return this.inner.open(url, viewport);
  }
  async snapshot() {
    return this.inner.snapshot();
  }
  async screenshot() {
    return this.inner.screenshot();
  }
  async moveMouse(point: Point): Promise<void> {
    this.calls.push("moveMouse");
    return this.inner.moveMouse(point);
  }
  async clickAt(point: Point): Promise<void> {
    this.calls.push("clickAt");
    return this.inner.clickAt(point);
  }
  async doubleClickAt(point: Point): Promise<void> {
    this.calls.push("doubleClickAt");
    return this.inner.doubleClickAt(point);
  }
  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    this.calls.push("typeText");
    return this.inner.typeText(text, perCharIntervalMs);
  }
  async pressKey(key: string): Promise<void> {
    this.calls.push("pressKey");
    return this.inner.pressKey(key);
  }
  async scrollBy(deltaY: number): Promise<void> {
    this.calls.push("scrollBy");
    return this.inner.scrollBy(deltaY);
  }
  async goBack(): Promise<void> {
    this.calls.push("goBack");
    return this.inner.goBack();
  }
  async navigate(url: string): Promise<void> {
    this.calls.push("navigate");
    return this.inner.navigate(url);
  }
  async close(): Promise<void> {
    this.calls.push("close");
    return this.inner.close();
  }
}

describe("session-level touch execution path", () => {
  it("never moves a mouse pointer and does actuate taps, on a touch-capable adapter", async () => {
    const adapter = new RecordingTouchAdapter();
    const result = await new EveSession({
      adapter,
      startUrl: "mock:",
      persona: "impatient-user",
      seed: 7,
      maxSteps: 10,
      paceScale: 0,
    }).run();

    expect(result.usage.steps).toBeGreaterThan(0);
    // The one invariant this integration point exists to prove: a touch
    // surface has no persistent pointer, so execute() must never call
    // moveMouse — not for clicks (skipped ahead of the tap), and not for
    // hover (skipped entirely, per capabilities.canHover).
    expect(adapter.calls).not.toContain("moveMouse");
    // The mock app's landing page is all clickable links/buttons; a curious
    // explorer with 10 steps and no goal reliably clicks at least one.
    expect(adapter.calls).toContain("clickAt");
  });
});
