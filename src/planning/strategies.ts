/**
 * Exploration strategies shape how the operator prioritizes when the current
 * goal is open-ended exploration rather than one concrete task.
 */
export type ExplorationStrategy = "curious" | "systematic" | "goal-directed";

export interface StrategyWeights {
  /** Multiplier on novelty in salience scoring. */
  noveltyWeight: number;
  /** Multiplier on goal relevance in salience scoring. */
  goalWeight: number;
  /** Probability of scrolling to survey the full page before acting. */
  surveyBias: number;
  /** Tendency to finish one screen before moving on. */
  completionBias: number;
}

export function strategyWeights(strategy: ExplorationStrategy): StrategyWeights {
  switch (strategy) {
    case "curious":
      return { noveltyWeight: 1.4, goalWeight: 0.7, surveyBias: 0.25, completionBias: 0.3 };
    case "systematic":
      return { noveltyWeight: 1.0, goalWeight: 0.9, surveyBias: 0.5, completionBias: 0.85 };
    case "goal-directed":
      return { noveltyWeight: 0.5, goalWeight: 1.5, surveyBias: 0.15, completionBias: 0.5 };
  }
}
