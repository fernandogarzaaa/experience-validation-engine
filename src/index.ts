/**
 * Experience Validation Engine (EVE)
 * "AI that experiences software like a human."
 *
 * Public API surface. See docs/api-reference.md for the guided tour.
 *
 * Two subsystems are reached through their own subpath exports rather than
 * this barrel, because both declare types whose names (`Observation`,
 * `Experience`, `Provenance`, `Measurement`) are deliberately generic on the
 * wire and would collide with EVE's own vocabulary if flattened into one
 * namespace:
 *
 * - `experience-validation-engine/protocol` — the CP/1 binding, by which EVE,
 *   ADAM and AXIOM-AETHER exchange documents as one organism.
 * - `experience-validation-engine/fitness` — counterfactual fitness
 *   measurement, EVE's role in the developmental lifecycle.
 */

// Phase-3: autonomous exploration → application map
export * from "./appmap/index.js";
// Phase-2: benchmark suite
export * from "./benchmarks/index.js";
// Browser adapters
export * from "./browser/index.js";
// Phase-3: human validation engine (calibrate EVE against real human traces)
export * from "./calibration/index.js";
// Cognition
export * from "./cognition/index.js";
// Phase-2: collaborative multi-operator sessions
export * from "./collaborative/index.js";
// Configuration
export * from "./config/index.js";
export type { EveEventMap, EveEventName } from "./core/events.js";
export { EventBus } from "./core/events.js";
// Vocabulary registries (formerly closed unions; see src/core/registry.ts)
export { findingCategoryRegistry, registerFindingCategory } from "./core/findingCategories.js";
export type {
  Affordance,
  AffordanceLocator,
  ContentBlock,
  DocumentKernelPercept,
  FrameIdentity,
  KernelAction,
  KernelPercept,
  SurfaceSignal,
  TextualKernelPercept,
  VisualKernelPercept,
} from "./core/kernel.js";
export type { Rng } from "./core/random.js";
export { createRng, seedFromString } from "./core/random.js";
export type {
  ActionVerbEntry,
  EveRegistries,
  FindingCategoryEntry,
  Modality,
  RegistryEntry,
  ScoreDimensionEntry,
} from "./core/registry.js";
export { ALL_MODALITIES, EveRegistry } from "./core/registry.js";
// Core types
export type {
  Action,
  BoundingBox,
  Finding,
  FindingCategory,
  FindingSeverity,
  LoopIteration,
  PerceivedRole,
  Percept,
  Point,
  Prediction,
  PredictionOutcome,
  Score,
  ScoreDimension,
  SessionUsage,
  Viewport,
  VisibleDialog,
  VisibleElement,
} from "./core/types.js";
export { describeAction, FINDING_CATEGORIES, SCORE_DIMENSIONS } from "./core/types.js";
// Emotion
export * from "./emotion/index.js";
export type { CognitiveConfig, CognitiveLoadTimeline } from "./engine/cognitiveSuite.js";
export { CognitiveSuite } from "./engine/cognitiveSuite.js";
export type { SessionOptions, SessionResult } from "./engine/session.js";
// Engine
export { EveSession } from "./engine/session.js";
// Phase-3: EVE Bench — the formal multi-dimensional benchmark platform
export * from "./evebench/index.js";
// Phase-2: experience forecasting
export * from "./forecasting/index.js";
// The humanity seam: EVE reads digital output (documents, decks, analytics,
// transcripts, payloads) rather than only driving interactive surfaces.
export * from "./humanity/index.js";
// Expansion Phase-1: MCP server evaluation (deterministic oracles + vocabulary)
export * from "./mcpEval/index.js";
// Memory
export * from "./memory/index.js";
// Phase-3: multimodal perception (icons, charts, loading, toasts, motion)
export * from "./multimodal/index.js";
// Observation
export * from "./observation/index.js";
// Phase-2: AI evaluation panel (design critic, moderator, PM, developer)
export * from "./panel/index.js";
// Personas
export * from "./personas/index.js";
// Planning
export * from "./planning/index.js";
// Plugins
export * from "./plugins/index.js";
// Phase-3: population simulation (many operators → statistical usability study)
export * from "./population/index.js";
// Phase-3: predictive UX (confusion / abandonment / support with CIs)
export * from "./predict/index.js";
// Phase-3: product intelligence (personas, workflows, goals, friction, drop-off)
export * from "./product/index.js";
// Phase-2: experience & behavioral regression
export * from "./regression/index.js";
// Reporting
export * from "./reporting/index.js";
// Phase-3: research-mode dataset export (JSON / CSV / Markdown)
export * from "./research/index.js";
// Scoring
export * from "./scoring/index.js";
// Phase-3: AI-moderated user study (specialist panel + moderator synthesis)
export * from "./study/index.js";
// Non-browser surfaces (textual seam: CLI adapter, MCP adapter + connector)
export type { SurfaceCapabilities } from "./surface/capabilities.js";
export {
  DOCUMENT_SURFACE,
  DOCUMENT_VERBS,
  TEXTUAL_SURFACE,
  TOUCH_VISUAL_SURFACE,
  VISUAL_SURFACE,
} from "./surface/capabilities.js";
export { CliAdapter, type CliAdapterOptions } from "./surface/cli.js";
export { McpAdapter, type McpAdapterOptions } from "./surface/mcp.js";
export {
  connectMcpInProcess,
  connectMcpServer,
  type McpCallOutcome,
  type McpConnection,
  type McpConnector,
} from "./surface/mcpClient.js";
// Phase-3: continuous UX regression (experience trends across builds)
export * from "./trends/index.js";
// Phase-3: human digital twins (persistent, evolving user models)
export * from "./twins/index.js";
// Vision
export * from "./vision/index.js";
// Workflow discovery
export * from "./workflow/index.js";
