/**
 * Human digital twins — persistent, evolving user models. Create a named twin,
 * run sessions as that twin (using and updating its memory), and watch it grow
 * more expert and confident across sessions.
 */

export {
  createTwin,
  twinPersona,
  evolveTwin,
  runTwinSession,
  type CreateTwinSpec,
  type TwinSessionConfig,
  type TwinSessionResult,
} from "./twin.js";
export { renderTwinMarkdown } from "./report.js";
export { FileTwinStore, InMemoryTwinStore, type TwinStore } from "./store.js";
export type { TwinProfile, TwinEvolution, TwinSessionOutcome } from "./types.js";
