import {
  type AttentionSnapshot,
  allocateAttention,
  attendedPercept,
  type Fixation,
} from "../cognition/attention.js";
import type { Decision } from "../cognition/cognition.js";
import {
  type CognitiveLoadBreakdown,
  DecisionFatigue,
  estimateCognitiveLoad,
} from "../cognition/cognitiveLoad.js";
import {
  buildExpectation,
  type ExpectationScore,
  scoreExpectation,
  ViolationStreak,
} from "../cognition/expectation.js";
import type { Rng } from "../core/random.js";
import type { Percept, PredictionOutcome } from "../core/types.js";
import type { EmotionalState } from "../emotion/emotionalState.js";
import { TrustModel, type TrustSample } from "../emotion/trust.js";
import type { ApplicationMemory } from "../memory/longTerm.js";
import { cultureOf } from "../personas/culture.js";
import type { Persona } from "../personas/persona.js";

/**
 * CognitiveSuite bundles the phase-2 per-step cognitive subsystems —
 * selective attention, cognitive-load estimation, the trust model, the
 * expectation engine, decision fatigue, and cross-session recall — behind a
 * small interface the session drives. It is instantiated only when the
 * enhanced cognitive mode is enabled, so phase-1 behavior is untouched when
 * it is absent.
 */

export interface CognitiveConfig {
  attention?: boolean;
  trust?: boolean;
  cognitiveLoad?: boolean;
  expectationEngine?: boolean;
}

export interface StepPerception {
  /** The percept restricted to what the operator actually attended to. */
  readonly perceptForDecision: Percept;
  readonly attention: AttentionSnapshot | null;
  readonly load: CognitiveLoadBreakdown | null;
}

export interface CognitiveLoadTimeline {
  meanIndex: number;
  peakIndex: number;
  samples: Array<{ step: number; index: number; breakdown: CognitiveLoadBreakdown }>;
}

export class CognitiveSuite {
  private readonly config: Required<CognitiveConfig>;
  private readonly trustModel = new TrustModel();
  private readonly fatigue = new DecisionFatigue();
  private readonly streak = new ViolationStreak();
  private readonly loadSamples: CognitiveLoadTimeline["samples"] = [];
  private readonly fixationLog: Array<{ step: number; fixations: readonly Fixation[] }> = [];
  private readonly expectationLog: ExpectationScore[] = [];
  private missedChangeCount = 0;
  private lastExpectationScore: ExpectationScore | null = null;

  constructor(
    private readonly persona: Persona,
    private readonly rng: Rng,
    private readonly longTerm: ApplicationMemory | null,
    config: CognitiveConfig | true,
  ) {
    const c = config === true ? {} : config;
    this.config = {
      attention: c.attention ?? true,
      trust: c.trust ?? true,
      cognitiveLoad: c.cognitiveLoad ?? true,
      expectationEngine: c.expectationEngine ?? true,
    };
  }

  /** Recall function passed to the decision policy for cross-session bias. */
  recall(): ((label: string) => number) | undefined {
    if (!this.longTerm) return undefined;
    const facts = Object.values(this.longTerm.facts);
    return (label: string) => {
      const l = label.trim().toLowerCase();
      if (!l) return 0;
      // A remembered successful location for this label is a positive signal;
      // a remembered warning is negative.
      let signal = 0;
      for (const screen of Object.values(this.longTerm!.screens)) {
        const strength = screen.affordances[l];
        if (strength) signal = Math.max(signal, strength * 0.6);
      }
      for (const fact of facts) {
        if (fact.statement.toLowerCase().includes(l)) {
          signal += fact.kind === "warning" ? -fact.confidence : fact.confidence * 0.3;
        }
      }
      return Math.max(-1, Math.min(1, signal));
    };
  }

  /** Perceive one screen: allocate attention and estimate load. */
  perceive(
    percept: Percept,
    previousPercept: Percept | null,
    goalKeywords: readonly string[],
  ): StepPerception {
    let attention: AttentionSnapshot | null = null;
    let perceptForDecision = percept;
    if (this.config.attention) {
      attention = allocateAttention(
        percept,
        previousPercept,
        goalKeywords,
        this.persona,
        this.rng,
        {
          readingDirection: cultureOf(this.persona).readingDirection,
        },
      );
      this.fixationLog.push({ step: this.fixationLog.length, fixations: attention.fixations });
      this.missedChangeCount += attention.missedChanges.length;
      // Only attended elements enter the decision. Dialogs are always kept.
      perceptForDecision = attendedPercept(percept, attention);
    }

    let load: CognitiveLoadBreakdown | null = null;
    if (this.config.cognitiveLoad) {
      load = estimateCognitiveLoad(percept, previousPercept, this.persona);
      this.loadSamples.push({ step: this.loadSamples.length, index: load.index, breakdown: load });
      this.fatigue.register(load.index);
    }

    if (this.config.trust) this.trustModel.observeSecurityCues(percept);

    return { perceptForDecision, attention, load };
  }

  /** Extra fields to merge into the decision policy's cognitive context. */
  contextEnrichment(load: CognitiveLoadBreakdown | null): {
    trust?: number;
    cognitiveLoadIndex?: number;
    decisionFatigue?: number;
    recall?: (label: string) => number;
  } {
    const recall = this.recall();
    return {
      trust: this.config.trust ? this.trustModel.overall() : undefined,
      cognitiveLoadIndex: load?.index,
      decisionFatigue: this.config.cognitiveLoad ? this.fatigue.level() : undefined,
      ...(recall ? { recall } : {}),
    };
  }

  /**
   * After an action's outcome is known, update trust, expectation scoring
   * and feed the results back into emotion. Returns the expectation score (if
   * the expectation engine is on) for logging.
   */
  afterOutcome(
    decision: Decision,
    outcome: PredictionOutcome,
    before: Percept,
    after: Percept,
    emotion: EmotionalState,
    step: number,
  ): ExpectationScore | null {
    const perceivedError = outcome.errorPerceived;
    const gaveFeedback = outcome.screenChanged;

    let expectationScore: ExpectationScore | null = null;
    if (this.config.expectationEngine) {
      const target =
        decision.action.kind === "click" ||
        decision.action.kind === "type" ||
        decision.action.kind === "hover" ||
        decision.action.kind === "doubleClick"
          ? decision.action.target
          : null;
      const expectation = buildExpectation(decision.prediction, target, decision.action.kind);
      expectationScore = scoreExpectation(expectation, before, after, outcome.perceivedLatencyMs);
      this.expectationLog.push(expectationScore);
      this.lastExpectationScore = expectationScore;

      // Repeated violations compound frustration and reduce trust further
      // (learned unpredictability).
      const streakLen = this.streak.register(expectationScore);
      if (streakLen >= 2) {
        emotion.adjust("frustration", 0.05 * streakLen);
        emotion.adjust("confidence", -0.03 * streakLen);
      }
      if (expectationScore.violationSeverity > 0.5) {
        emotion.adjust("confusion", expectationScore.violationSeverity * 0.15);
      }
    }

    if (this.config.trust) {
      this.trustModel.update(outcome, perceivedError, gaveFeedback);
      this.trustModel.record(step);
      // Trust model owns the trust dimension when active.
      emotion.override("trust", this.trustModel.overall());
    }

    if (this.config.cognitiveLoad) {
      // Decision fatigue feeds bodily fatigue.
      emotion.adjust("fatigue", this.fatigue.level() * 0.01);
    }

    return expectationScore;
  }

  /** Consistency reinforcement when revisiting a remembered screen. */
  reinforceConsistency(sameAsRemembered: boolean): void {
    if (this.config.trust) this.trustModel.reinforceConsistency(sameAsRemembered);
  }

  /* ---- collectors for the session result ---- */

  trustTimeline(): readonly TrustSample[] {
    return this.trustModel.timeline();
  }

  cognitiveLoadTimeline(): CognitiveLoadTimeline | null {
    if (!this.config.cognitiveLoad || this.loadSamples.length === 0) return null;
    const indices = this.loadSamples.map((s) => s.index);
    return {
      meanIndex: Math.round(indices.reduce((a, b) => a + b, 0) / indices.length),
      peakIndex: Math.max(...indices),
      samples: this.loadSamples,
    };
  }

  attentionSummary(): {
    fixations: Array<{ step: number; fixations: readonly Fixation[] }>;
    missedChanges: number;
  } | null {
    if (!this.config.attention) return null;
    return { fixations: this.fixationLog, missedChanges: this.missedChangeCount };
  }

  expectationTimeline(): readonly ExpectationScore[] {
    return this.expectationLog;
  }

  lastScore(): ExpectationScore | null {
    return this.lastExpectationScore;
  }
}

export type { CognitiveLoadBreakdown, ExpectationScore, Fixation, TrustSample };
