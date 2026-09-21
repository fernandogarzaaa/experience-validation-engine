import type { Percept } from "../core/types.js";
import type { AdapterOptions } from "./adapter.js";

/**
 * Native-dialog handling shared by all browser adapters (P0.2).
 *
 * A real native dialog (alert/confirm/prompt) blocks page JS until handled,
 * so no adapter can hold it open for an asynchronous cognition pass without
 * deadlocking perception. The contract every adapter implements:
 *
 * 1. record the dialog text,
 * 2. surface it on the next percept as `VisibleDialog(source: "native")` so
 *    cognition DOES see it (reaction happens on the following decision),
 * 3. unblock with the SAFE default — dismiss — unless the caller explicitly
 *    opted into `nativeDialogAction: "accept"`.
 *
 * Destructive or consequential dialogs are therefore never auto-accepted by
 * default. The handling is recorded in `autoHandled`, never presented as the
 * operator's intentional decision.
 */

export type NativeDialogHandling = "accepted" | "dismissed";

export interface PendingNativeDialog {
  readonly text: string;
  readonly autoHandled: NativeDialogHandling;
}

/** Safe-default resolution: anything but explicit "accept" dismisses. */
export function resolveNativeDialogHandling(
  action: AdapterOptions["nativeDialogAction"],
): NativeDialogHandling {
  return action === "accept" ? "accepted" : "dismissed";
}

export function recordNativeDialog(
  pending: PendingNativeDialog[],
  message: string,
  action: AdapterOptions["nativeDialogAction"],
): NativeDialogHandling {
  const autoHandled = resolveNativeDialogHandling(action);
  pending.push({ text: message, autoHandled });
  return autoHandled;
}

/** Surface pending native dialogs on a snapshot (clears the queue). */
export function mergeNativeDialogs(
  dialogs: Percept["dialogs"],
  pending: PendingNativeDialog[],
): Percept["dialogs"] {
  if (pending.length === 0) return dialogs;
  const merged: Percept["dialogs"] = [
    ...dialogs,
    ...pending.map((d) => ({
      text: d.text,
      box: null,
      source: "native" as const,
      autoHandled: d.autoHandled,
    })),
  ];
  pending.length = 0;
  return merged;
}
