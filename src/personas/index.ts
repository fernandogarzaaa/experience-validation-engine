export {
  definePersona,
  readingTimeMs,
  motorActionMs,
  typingIntervalMs,
  clickScatterPx,
  workingMemoryCapacity,
  abandonmentThreshold,
  BASELINE_TRAITS,
  DEFAULT_ACCESSIBILITY,
} from "./persona.js";
export type {
  Persona,
  PersonaSpec,
  PersonaTraits,
  AccessibilityProfile,
} from "./persona.js";
export { listPersonas, getPersona, registerPersona } from "./library.js";
