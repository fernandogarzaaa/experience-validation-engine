/**
 * The action-verb registry.
 *
 * The nine CP/1 canonical verbs (`ExperienceAction`) are pre-registered as
 * built-ins with `onCp1Wire: true`. Domain packs may register additional
 * engine-side verbs (e.g. an MCP "invoke" or an agent "tool-call"), which
 * are always registered `onCp1Wire: false`: widening the canonical verb set
 * changes the CP/1 canonical form, which SPEC §8 reserves for a protocol
 * version change. Off-wire verbs collapse onto the nearest canonical verb
 * when an `Experience` is minted — the same policy `ACTION_MAP` in
 * `documents.ts` already applies to `doubleClick` and `hover`.
 */

import { type ActionVerbEntry, ALL_MODALITIES, EveRegistry } from "../core/registry.js";
import { EXPERIENCE_ACTIONS } from "./types.js";

export const actionVerbRegistry = new EveRegistry<ActionVerbEntry>("action verb");
for (const id of EXPERIENCE_ACTIONS) {
  actionVerbRegistry.register({
    id,
    builtin: true,
    appliesTo: ALL_MODALITIES,
    onCp1Wire: true,
  });
}

/**
 * Register an engine-side action verb. Never lands on the CP/1 wire —
 * see the module docstring for why that is a protocol decision, not a
 * registration.
 */
export function registerActionVerb(
  entry: Omit<ActionVerbEntry, "builtin" | "onCp1Wire" | "appliesTo"> &
    Partial<Pick<ActionVerbEntry, "appliesTo">>,
): void {
  actionVerbRegistry.register({
    ...entry,
    appliesTo: entry.appliesTo ?? ALL_MODALITIES,
    builtin: false,
    onCp1Wire: false,
  });
}
