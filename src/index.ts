/**
 * Experience Validation Engine (EVE)
 * "AI that experiences software like a human."
 *
 * Public API surface. See docs/api-reference.md for the guided tour.
 */

// Core types
export type {
  Percept,
  VisibleElement,
  VisibleDialog,
  PerceivedRole,
  BoundingBox,
  Point,
  Viewport,
  Action,
  Prediction,
  PredictionOutcome,
  Finding,
  FindingSeverity,
  FindingCategory,
  Score,
  ScoreDimension,
  LoopIteration,
  SessionUsage,
} from "./core/types.js";
export { describeAction } from "./core/types.js";
export { createRng, seedFromString } from "./core/random.js";
export type { Rng } from "./core/random.js";
export { EventBus } from "./core/events.js";
export type { EveEventMap, EveEventName } from "./core/events.js";

// Engine
export { EveSession } from "./engine/session.js";
export type { SessionOptions, SessionResult } from "./engine/session.js";

// Personas
export * from "./personas/index.js";

// Emotion
export * from "./emotion/index.js";

// Memory
export * from "./memory/index.js";

// Cognition
export * from "./cognition/index.js";

// Planning
export * from "./planning/index.js";

// Observation
export * from "./observation/index.js";

// Vision
export * from "./vision/index.js";

// Browser adapters
export * from "./browser/index.js";

// Workflow discovery
export * from "./workflow/index.js";

// Scoring
export * from "./scoring/index.js";

// Plugins
export * from "./plugins/index.js";

// Reporting
export * from "./reporting/index.js";

// Configuration
export * from "./config/index.js";
