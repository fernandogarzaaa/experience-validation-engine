import { describe, expect, it } from "vitest";
import type { Percept } from "../src/core/types.js";
import type { CanonicalSurfaceIdentity } from "../src/memory/index.js";
import {
  canonicalFromPercept,
  canonicalMatchBasis,
  canonicalSurfaceId,
  stableIdentityKey,
} from "../src/memory/index.js";

function percept(url = "https://x.test/app"): Percept {
  return {
    timestamp: 0,
    url,
    title: "T",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements: [],
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("CanonicalSurfaceIdentity (Phase 4)", () => {
  it("is deterministic and explainable", () => {
    const a = canonicalFromPercept(percept(), "checkout_basic_01");
    const b = canonicalFromPercept(percept(), "checkout_basic_01");
    expect(canonicalSurfaceId(a)).toBe(canonicalSurfaceId(b));
    expect(a.kind).toBe("eve-stable");
    expect(a.eveStableKey).toBe(stableIdentityKey(percept()));
    expect(a.provenance).toBe("eve-perception");
  });

  it("matches human and EVE references on shared task + state", () => {
    const eve = canonicalFromPercept(percept(), "checkout_basic_01");
    const human: CanonicalSurfaceIdentity = {
      kind: "human",
      taskId: "checkout_basic_01",
      url: "https://x.test/app",
      externalStateId: "screen-3",
      provenance: "human-report",
    };
    // URL-only fallback (no shared keys carried by the human side).
    expect(canonicalMatchBasis(eve, human)).toBe("task+url");
    const humanKeyed: CanonicalSurfaceIdentity = {
      ...human,
      eveStableKey: eve.eveStableKey,
    };
    expect(canonicalMatchBasis(eve, humanKeyed)).toBe("task+stable");
  });

  it("refuses matches across different tasks", () => {
    const a = canonicalFromPercept(percept(), "task_a");
    const b = canonicalFromPercept(percept(), "task_b");
    expect(canonicalMatchBasis(a, b)).toBeNull();
  });

  it("treats external ids as opaque equality, never parsed", () => {
    const a: CanonicalSurfaceIdentity = {
      kind: "agent",
      taskId: null,
      url: null,
      externalStateId: "dom-node-42",
      provenance: "agent-log",
    };
    const b: CanonicalSurfaceIdentity = { ...a };
    expect(canonicalMatchBasis(a, b)).toBe("external-id");
    // DOM ids are carried opaquely; the scheme never inspects structure.
    expect(canonicalSurfaceId(a)).toContain("dom-node-42");
  });

  it("returns null when nothing is shared", () => {
    const a: CanonicalSurfaceIdentity = {
      kind: "human",
      taskId: null,
      url: null,
      provenance: "human-report",
    };
    const b: CanonicalSurfaceIdentity = {
      kind: "agent",
      taskId: null,
      url: null,
      externalStateId: "other",
      provenance: "agent-log",
    };
    expect(canonicalMatchBasis(a, b)).toBeNull();
  });
});
