export type {
  GoalAssessment,
  GoalEvidence,
  GoalEvidenceKind,
  GoalEvidenceStrength,
} from "./evidence.js";
export { assessGoal, assessGoalOnPercepts, matchSignal } from "./evidence.js";
export type { Goal, GoalStatus } from "./goals.js";
export { createGoal, GoalStack } from "./goals.js";
export type { ExplorationStrategy, StrategyWeights } from "./strategies.js";
export { strategyWeights } from "./strategies.js";
export type {
  TaskBounds,
  TaskFamily,
  TaskSpec,
  TaskStartingConditions,
} from "./task.js";
export { matchTaskIds, normalizeTaskId, resolveTaskId } from "./task.js";
