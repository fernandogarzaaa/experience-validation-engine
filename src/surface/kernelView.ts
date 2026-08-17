/**
 * `WebPerceptView` — the deprecated projection of a kernel percept back into
 * the legacy browser-flavored {@link Percept} (Phase 2 compatibility shim;
 * see `docs/kernel.md`).
 *
 * Visual kernels round-trip through `webPerceptFromVisualKernel`
 * (`src/core/kernel.ts`). Textual kernels are laid out through the same
 * char-cell geometry the CLI/MCP adapters have always used, so the legacy
 * view of a kernel-native textual surface is byte-for-byte the kind of
 * snapshot Phase-1 consumers already handled.
 *
 * This is the direction that loses fidelity by design: typed signals
 * collapse onto dialogs/loading, structured affordance metadata is dropped,
 * and non-ARIA affordance kinds map onto the nearest legacy role. Consumers
 * that need the fidelity should consume the kernel directly.
 */

import {
  type KernelPercept,
  type SurfaceSignal,
  webPerceptFromVisualKernel,
} from "../core/kernel.js";
import type { PerceivedRole, Percept } from "../core/types.js";
import { layoutTextFrame } from "./textFrame.js";

/** Project any kernel percept into the deprecated web view. */
export function webPerceptFromKernel(kernel: KernelPercept): Percept {
  if (kernel.modality === "visual") return webPerceptFromVisualKernel(kernel);

  const laid = layoutTextFrame({
    lines: [...kernel.lines],
    affordances: kernel.affordances
      .filter((a) => a.locator.kind === "charCell")
      .map((a) => {
        const locator = a.locator as Extract<typeof a.locator, { kind: "charCell" }>;
        return {
          line: locator.line,
          column: locator.column,
          text: legacyLabel(a.description),
          role: legacyRole(a.kind, a.state.editable),
        };
      }),
    windowRows: kernel.windowRows,
    scrollLine: kernel.scrollLine,
  });

  return {
    timestamp: kernel.timestamp,
    url: kernel.frame.address,
    title: kernel.frame.label,
    viewport: laid.viewport,
    scrollY: laid.scrollY,
    scrollHeight: laid.scrollHeight,
    screenshot: null,
    elements: laid.elements,
    dialogs: legacyDialogs(kernel.signals),
    loadingIndicator: kernel.signals.some((s) => s.type === "loading" && s.active),
  };
}

/** The web view's one "attention-demanding" slot: error signals become dialogs. */
function legacyDialogs(signals: readonly SurfaceSignal[]): Percept["dialogs"] {
  return signals
    .filter(
      (s): s is Extract<SurfaceSignal, { type: "dialog" | "error" }> =>
        s.type === "dialog" || s.type === "error",
    )
    .map((s) => ({ text: s.text, box: null }));
}

/** Kernel kinds that are not ARIA roles map onto the nearest legacy role. */
function legacyRole(kind: string, editable: boolean | undefined): PerceivedRole {
  if (LEGACY_ROLES.has(kind)) return kind as PerceivedRole;
  if (editable) return "textbox";
  if (kind === "mcp.field") return "textbox";
  if (kind === "mcp.tool") return "menuitem";
  return "button";
}

function legacyLabel(description: string): string {
  return description.trim().replace(/\s+/g, " ");
}

const LEGACY_ROLES: ReadonlySet<string> = new Set([
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
