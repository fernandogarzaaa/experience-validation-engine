/**
 * Human digital twins — persistent, evolving user models. Create a named twin,
 * run sessions as that twin (using and updating its memory), and watch it grow
 * more expert and confident across sessions.
 */

export { renderTwinMarkdown } from "./report.js";
export { FileTwinStore, InMemoryTwinStore, type TwinStore } from "./store.js";
export {
  type CreateTwinSpec,
  createTwin,
  evolveTwin,
  runTwinSession,
  type TwinSessionConfig,
  type TwinSessionResult,
  twinPersona,
} from "./twin.js";
export type { TwinEvolution, TwinProfile, TwinSessionOutcome } from "./types.js";
