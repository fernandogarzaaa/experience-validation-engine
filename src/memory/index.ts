export type { LearningMetrics } from "./learning.js";
export {
  computeLearningMetrics,
  forgettingCurve,
  renderLearningCurveSvg,
} from "./learning.js";
export type {
  ApplicationMemory,
  MemoryStore,
  PersistentMemory,
  RememberedScreen,
  SessionMemoryRecord,
  SharedApplicationKnowledge,
} from "./longTerm.js";
export {
  appIdForUrl,
  applyForgetting,
  emptyApplicationMemory,
  FileMemoryStore,
  InMemoryStore,
  memoryKeyFor,
  retainedKnowledge,
} from "./longTerm.js";
export type {
  Episode,
  LearnedFact,
  ScreenEdge,
  ScreenNode,
  WorkingMemoryItem,
} from "./memory.js";
export { isAffordanceAvailable, OperatorMemory, screenSignature } from "./memory.js";
export type {
  QueryNormalization,
  QueryParameterClassification,
  QueryStateClassification,
  QueryStatePolicy,
  SensitiveStateOptions,
} from "./surfaceIdentity.js";
export {
  classifiedQuery,
  classifyQueryDetailed,
  DEFAULT_QUERY_STATE_POLICY,
  sameState,
  sameSurface,
  sensitiveStateKey,
  stableIdentityKey,
  surfaceIdentity,
} from "./surfaceIdentity.js";
