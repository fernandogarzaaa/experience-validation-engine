import { describe, expect, it } from "vitest";
import { createRng } from "../src/core/random.js";
import type { Percept, VisibleElement } from "../src/core/types.js";
import { isAffordanceAvailable, OperatorMemory, screenSignature } from "../src/memory/index.js";
import {
  classifiedQuery,
  classifyQueryDetailed,
  DEFAULT_QUERY_STATE_POLICY,
  sameState,
  sameSurface,
  sensitiveStateKey,
  stableIdentityKey,
} from "../src/memory/surfaceIdentity.js";
import { getPersona } from "../src/personas/index.js";

let id = 0;
function vis(text: string, overrides: Partial<VisibleElement> = {}): VisibleElement {
  return {
    id: id++,
    role: "button",
    text,
    box: { x: 10, y: 10, width: 120, height: 36 },
    interactive: true,
    disabled: false,
    editable: false,
    focused: false,
    clippedByViewport: false,
    ...overrides,
  };
}

function percept(
  url: string,
  elements: VisibleElement[],
  dialogs: Percept["dialogs"] = [],
): Percept {
  return {
    timestamp: 0,
    url,
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs,
    loadingIndicator: false,
  };
}

describe("two-tier identity (reviewer decision 1)", () => {
  it("same perceptual state → same stable key and same sensitive state", () => {
    const a = percept("https://x.test/app", [vis("Save")]);
    const b = percept("https://x.test/app", [vis("Save")]);
    expect(stableIdentityKey(a)).toBe(stableIdentityKey(b));
    expect(sameSurface(a, b)).toBe(true);
    expect(sameState(a, b)).toBe(true);
  });

  it("query tabs share stable identity but differ in sensitive state", () => {
    const a = percept("https://x.test/app?tab=settings", [vis("Save")]);
    const b = percept("https://x.test/app?tab=billing", [vis("Save")]);
    expect(sameSurface(a, b)).toBe(true);
    expect(sameState(a, b)).toBe(false);
  });

  it("open dialog: same stable layout, different sensitive state", () => {
    const base = percept("https://x.test/app", [vis("Save")]);
    const withDialog = percept(
      "https://x.test/app",
      [vis("Save")],
      [{ text: "Are you sure?", box: null }],
    );
    expect(sameSurface(base, withDialog)).toBe(true);
    expect(sameState(base, withDialog)).toBe(false);
    const withDialog2 = percept(
      "https://x.test/app",
      [vis("Save")],
      [{ text: "Are you sure?", box: null }],
    );
    expect(sameState(withDialog, withDialog2)).toBe(true);
  });

  it("validation-error signal forks sensitive state, not stable identity", () => {
    const plain = percept("https://x.test/form", [vis("Save")]);
    expect(
      sensitiveStateKey(plain, { errorSignal: false }) ===
        sensitiveStateKey(plain, { errorSignal: true }),
    ).toBe(false);
    expect(stableIdentityKey(plain)).toBe(stableIdentityKey(plain));
  });

  it("typing into a field forks NEITHER tier (tried-mark stability)", () => {
    const before = percept("https://x.test/form", [
      { ...vis("Email address"), role: "textbox", editable: true },
    ]);
    const after = percept("https://x.test/form", [
      { ...vis("Email address (filled)"), role: "textbox", editable: true, focused: true },
    ]);
    expect(sameSurface(before, after)).toBe(true);
    expect(sameState(before, after)).toBe(true);
  });

  it("added/removed controls fork stable identity (modal menus)", () => {
    const a = percept("https://x.test/app", [vis("Save")]);
    const b = percept("https://x.test/app", [
      vis("Save"),
      { ...vis("Delete"), role: "menuitem", box: { x: 10, y: 60, width: 120, height: 36 } },
    ]);
    expect(sameSurface(a, b)).toBe(false);
    expect(sameState(a, b)).toBe(false);
  });

  it("legacy screenSignature is byte-identical (backwards compat)", () => {
    const p = percept("https://x.test/app?tab=1", [
      { ...vis("Dashboard"), role: "heading", interactive: false },
    ]);
    // origin + pathname (query dropped) :: lowercased heading
    expect(screenSignature(p)).toBe("https://x.test/app::dashboard");
  });
});

describe("semantic query classification (reviewer decision 2)", () => {
  it("state-bearing keys discriminate verbatim when short", () => {
    expect(classifiedQuery("https://x.test/d?tab=settings")).toContain("tab=settings");
    expect(classifiedQuery("https://x.test/d?tab=settings")).not.toBe(
      classifiedQuery("https://x.test/d?tab=billing"),
    );
  });

  it("high-cardinality keys never discriminate verbatim", () => {
    expect(classifiedQuery("https://x.test/d?q=ab")).toBe(classifiedQuery("https://x.test/d?q=xy"));
    expect(classifiedQuery("https://x.test/d?token=abc")).toBe(
      classifiedQuery("https://x.test/d?token=xyz"),
    );
  });

  it("long state-bearing values fall back to buckets", () => {
    const long = "x".repeat(200);
    expect(classifiedQuery(`https://x.test/d?tab=${long}`)).toContain("tab=l");
  });

  it("policy is configurable, not a fixed cutoff", () => {
    const custom = {
      ...DEFAULT_QUERY_STATE_POLICY,
      stateBearingKeys: [...DEFAULT_QUERY_STATE_POLICY.stateBearingKeys, "lane"],
    };
    expect(classifiedQuery("https://x.test/d?lane=left", custom)).toContain("lane=left");
    expect(classifiedQuery("https://x.test/d?lane=left")).not.toContain("lane=left");
  });

  it("repeated parameters keep distinct values distinct (CodeRabbit PR #39)", () => {
    expect(classifiedQuery("https://x.test/d?filter=a&filter=b")).not.toBe(
      classifiedQuery("https://x.test/d?filter=a&filter=c"),
    );
    // Pair order swaps do not fork identity.
    expect(classifiedQuery("https://x.test/d?b=2&a=1")).toBe(
      classifiedQuery("https://x.test/d?a=1&b=2"),
    );
    // Exact-duplicate pairs collapse.
    expect(classifiedQuery("https://x.test/d?a=1&a=1")).toBe(
      classifiedQuery("https://x.test/d?a=1"),
    );
  });
});

describe("OperatorMemory identity stability (P0.5 loop regression)", () => {
  it("tried-affordance marks survive typing (no re-type loop)", () => {
    const persona = getPersona("office-worker");
    const memory = new OperatorMemory(persona, createRng(1), stableIdentityKey);
    const before = percept("https://x.test/form", [
      { ...vis("Email address"), role: "textbox", editable: true },
    ]);
    memory.observeScreen(before, 0);
    memory.markTried(stableIdentityKey(before), "field:email");
    // After typing, the label changes and focus moves — lookup must still hit.
    const after = percept("https://x.test/form", [
      { ...vis("Email address (filled)"), role: "textbox", editable: true, focused: true },
    ]);
    const node = memory.knownScreens().find((s) => s.signature === stableIdentityKey(after));
    expect(node).toBeDefined();
    expect(node!.triedAffordances.has("field:email")).toBe(true);
    // Second visit → recognized (one visit is still novel by design).
    memory.observeScreen(after, 1);
    expect(memory.isNovelScreen(after)).toBe(false);
  });
});

describe("adversarial collision/aliasing matrix (reviewer §1)", () => {
  // Guarantee table: stable MAY collapse (familiarity tier); sensitive MUST
  // distinguish materially different states (attribution tier).
  const form = (extra: Partial<VisibleElement> = {}) =>
    percept("https://x.test/settings", [
      { ...vis("Save"), box: { x: 10, y: 100, width: 120, height: 36 } },
      {
        ...vis("Name"),
        role: "textbox",
        editable: true,
        box: { x: 10, y: 10, width: 200, height: 36 },
        ...extra,
      },
    ]);

  it("/settings?tab=general vs /settings?tab=security", () => {
    const g = percept("https://x.test/settings?tab=general", [vis("Save")]);
    const s = percept("https://x.test/settings?tab=security", [vis("Save")]);
    expect(sameSurface(g, s)).toBe(true);
    expect(sameState(g, s)).toBe(false);
  });

  it("form empty vs form populated (action-tracked fill state)", () => {
    const empty = form();
    expect(sameSurface(empty, empty)).toBe(true);
    expect(
      sensitiveStateKey(empty, { formFill: "empty" }) ===
        sensitiveStateKey(empty, { formFill: "populated" }),
    ).toBe(false);
    // Untouched by any type action, the states coincide (no phantom fork).
    expect(sameState(empty, empty)).toBe(true);
  });

  it("form plain vs form validation-error", () => {
    const plain = form();
    expect(sameSurface(plain, plain)).toBe(true);
    expect(sensitiveStateKey(plain, {})).not.toBe(sensitiveStateKey(plain, { errorSignal: true }));
  });

  it("modal closed vs modal open (new controls)", () => {
    const closed = percept("https://x.test/app", [vis("Open")]);
    const open = percept("https://x.test/app", [
      vis("Open"),
      { ...vis("Confirm"), box: { x: 10, y: 60, width: 120, height: 36 } },
    ]);
    expect(sameSurface(closed, open)).toBe(false);
    expect(sameState(closed, open)).toBe(false);
  });

  it("menu closed vs menu open", () => {
    const closed = percept("https://x.test/app", [vis("Menu")]);
    const open = percept("https://x.test/app", [
      vis("Menu"),
      { ...vis("Item"), role: "menuitem", box: { x: 10, y: 60, width: 120, height: 30 } },
    ]);
    expect(sameSurface(closed, open)).toBe(false);
  });

  it("error absent vs error present (alert dialog text)", () => {
    const ok = percept("https://x.test/app", [vis("Save")]);
    const err = percept(
      "https://x.test/app",
      [vis("Save")],
      [{ text: "Invalid password", box: null }],
    );
    expect(sameState(ok, err)).toBe(false);
  });

  it("same DOM structure + different semantic state (?mode)", () => {
    const a = percept("https://x.test/d?mode=view", [vis("Save")]);
    const b = percept("https://x.test/d?mode=edit", [vis("Save")]);
    expect(sameSurface(a, b)).toBe(true);
    expect(sameState(a, b)).toBe(false);
  });

  it("high-cardinality noise never forks either tier", () => {
    const a = percept("https://x.test/d?tab=settings&session=aaa", [vis("Save")]);
    const b = percept("https://x.test/d?tab=settings&session=bbb", [vis("Save")]);
    expect(sameSurface(a, b)).toBe(true);
    expect(sameState(a, b)).toBe(true);
  });
});

describe("interaction-state signature (reviewer final defect fix)", () => {
  // enabled/disabled/editable/interactive flips MUST fork sensitive state
  // (workflow attribution) while leaving stable identity untouched
  // (familiarity tier). Typing/focus/text never participate.
  const cases: Array<{
    name: string;
    a: Partial<VisibleElement>;
    b: Partial<VisibleElement>;
  }> = [
    { name: "enabled → disabled", a: {}, b: { disabled: true } },
    { name: "disabled → enabled", a: { disabled: true }, b: {} },
    {
      // Same role/geometry, only the editable flag flips (readonly field):
      // stable structure is untouched, interaction state differs.
      name: "editable → non-editable",
      a: { role: "textbox", editable: true },
      b: { role: "textbox", editable: false },
    },
    {
      // Menu items stay in the structural filter regardless of
      // interactivity, so only the sensitive tier observes the flip.
      name: "interactive → non-interactive",
      a: { role: "menuitem", interactive: true },
      b: { role: "menuitem", interactive: false },
    },
  ];
  it.each(cases.map((c) => [c.name, c.a, c.b] as const))(
    "%s forks sensitive only",
    (_name, aOver, bOver) => {
      const a = percept("https://x.test/app", [vis("Save", aOver)]);
      const b = percept("https://x.test/app", [vis("Save", bOver)]);
      expect(sameSurface(a, b)).toBe(true);
      expect(sameState(a, b)).toBe(false);
    },
  );

  it("label text edits and focus moves fork NEITHER tier", () => {
    const a = percept("https://x.test/app", [vis("Save")]);
    const b = percept("https://x.test/app", [vis("Save now!", { focused: true })]);
    expect(sameSurface(a, b)).toBe(true);
    expect(sameState(a, b)).toBe(true);
  });
});

describe("query classification explainability", () => {
  it("each component reports parameter, classification, normalization, reason", () => {
    const parts = classifyQueryDetailed("https://x.test/d?tab=settings&q=hello&zzz=1");
    const byParam = Object.fromEntries(parts.map((p) => [p.parameter, p]));
    expect(byParam.tab.classification).toBe("state-bearing");
    expect(byParam.tab.normalization).toBe("verbatim");
    expect(byParam.tab.reason).toBeTruthy();
    expect(byParam.q.classification).toBe("high-cardinality");
    expect(byParam.q.normalization).toBe("bucketed");
    expect(byParam.zzz.classification).toBe("unknown-key");
    expect(byParam.zzz.reason).toContain("policy");
  });
});

describe("availability rule (reviewer concern 12)", () => {
  const screen = (saveOverrides: Partial<VisibleElement> = {}) =>
    percept("https://x.test/app", [{ ...vis("Save"), ...saveOverrides }]);

  it("a tried label available right now counts as tried", () => {
    expect(isAffordanceAvailable(screen(), "Save")).toBe(true);
    expect(isAffordanceAvailable(screen(), "save")).toBe(true);
  });

  it("familiarity never proves availability: disabled or absent labels fail", () => {
    expect(isAffordanceAvailable(screen({ disabled: true }), "Save")).toBe(false);
    expect(isAffordanceAvailable(screen(), "Delete")).toBe(false);
    expect(isAffordanceAvailable(screen(), "")).toBe(false);
    expect(isAffordanceAvailable(screen(), "   ")).toBe(false);
  });

  it("tried-in-A, disabled-in-B: novelty is preserved in the new state", () => {
    // State A: Save enabled and tried. State B: same stable layout, Save
    // disabled. The tried-mark must not suppress re-evaluation in B.
    const persona = getPersona("office-worker");
    const memory = new OperatorMemory(persona, createRng(2), stableIdentityKey);
    const stateA = screen();
    memory.observeScreen(stateA, 0);
    memory.markTried(stableIdentityKey(stateA), "save");
    const stateB = screen({ disabled: true });
    // Same stable place...
    expect(sameSurface(stateA, stateB)).toBe(true);
    // ...but the affordance is not available in the state we're actually in.
    expect(isAffordanceAvailable(stateB, "save")).toBe(false);
  });
});

describe("repeated query parameters (CodeRabbit PR #46)", () => {
  it("preserves distinct repeated values instead of collapsing to the first", () => {
    expect(classifiedQuery("https://x.test/d?filter=a&filter=b")).not.toBe(
      classifiedQuery("https://x.test/d?filter=a&filter=c"),
    );
  });

  it("is order-insensitive across repeated pairs", () => {
    expect(classifiedQuery("https://x.test/d?filter=b&filter=a")).toBe(
      classifiedQuery("https://x.test/d?filter=a&filter=b"),
    );
  });

  it("reports every occurrence in detailed classification", () => {
    const parts = classifyQueryDetailed("https://x.test/d?filter=a&filter=b");
    expect(parts.filter((p) => p.parameter === "filter")).toHaveLength(2);
  });
});
