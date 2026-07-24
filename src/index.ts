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
export { CognitiveSuite } from "./engine/cognitiveSuite.js";
export type { CognitiveConfig, CognitiveLoadTimeline } from "./engine/cognitiveSuite.js";

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

// Phase-2: experience & behavioral regression
export * from "./regression/index.js";

// Phase-2: experience forecasting
export * from "./forecasting/index.js";

// Phase-2: AI evaluation panel (design critic, moderator, PM, developer)
export * from "./panel/index.js";

// Phase-2: benchmark suite
export * from "./benchmarks/index.js";

// Phase-2: collaborative multi-operator sessions
export * from "./collaborative/index.js";

// Phase-3: population simulation (many operators → statistical usability study)
export * from "./population/index.js";

// Phase-3: research-mode dataset export (JSON / CSV / Markdown)
export * from "./research/index.js";

// Phase-3: AI-moderated user study (specialist panel + moderator synthesis)
export * from "./study/index.js";

// Phase-3: product intelligence (personas, workflows, goals, friction, drop-off)
export * from "./product/index.js";

// Phase-3: continuous UX regression (experience trends across builds)
export * from "./trends/index.js";

// Phase-3: autonomous exploration → application map
export * from "./appmap/index.js";

// Phase-3: predictive UX (confusion / abandonment / support with CIs)
export * from "./predict/index.js";

// Phase-3: human digital twins (persistent, evolving user models)
export * from "./twins/index.js";

// Phase-3: human validation engine (calibrate EVE against real human traces)
export * from "./calibration/index.js";

// Phase-3: multimodal perception (icons, charts, loading, toasts, motion)
export * from "./multimodal/index.js";

// Phase-3: EVE Bench — the formal multi-dimensional benchmark platform
export * from "./evebench/index.js";
