import { describe, expect, it } from "vitest";
import {
  mergeNativeDialogs,
  recordNativeDialog,
  resolveNativeDialogHandling,
} from "../src/browser/index.js";
import { visibleText } from "../src/cognition/mentalModel.js";
import type { Percept } from "../src/core/types.js";

function percept(): Percept {
  return {
    timestamp: 0,
    url: "https://x.test/",
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

describe("native dialog handling (P0.2)", () => {
  it("defaults to dismiss: undefined/anything-but-accept never auto-accepts", () => {
    expect(resolveNativeDialogHandling(undefined)).toBe("dismissed");
    expect(resolveNativeDialogHandling("dismiss")).toBe("dismissed");
    expect(resolveNativeDialogHandling("accept")).toBe("accepted");
  });

  it("records dialog text and reports safe handling", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    const handling = recordNativeDialog(pending, "Delete everything?", undefined);
    expect(handling).toBe("dismissed");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.text).toBe("Delete everything?");
  });

  it("explicit opt-in accept is honored and labeled", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    expect(recordNativeDialog(pending, "OK?", "accept")).toBe("accepted");
    expect(pending[0]!.autoHandled).toBe("accepted");
  });

  it("merges as cognition-visible native dialogs and drains the queue", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    recordNativeDialog(pending, "Are you sure?", undefined);
    const merged = mergeNativeDialogs([], pending);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("native");
    expect(merged[0]!.autoHandled).toBe("dismissed");
    expect(pending).toHaveLength(0);
  });

  it("dialog text reaches cognition via visibleText (perception, not bypass)", () => {
    const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
    recordNativeDialog(pending, "Submit payment?", undefined);
    const p = { ...percept(), dialogs: mergeNativeDialogs([], pending) };
    expect(visibleText(p)).toContain("Submit payment?");
  });

  it("destructive confirmations are never auto-accepted by default", () => {
    for (const text of ["Delete everything?", "Are you sure?", "Submit payment?", "Leave page?"]) {
      const pending: { text: string; autoHandled: "accepted" | "dismissed" }[] = [];
      expect(recordNativeDialog(pending, text, undefined)).toBe("dismissed");
    }
  });
});
