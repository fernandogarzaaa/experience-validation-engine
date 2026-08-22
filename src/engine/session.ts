import { asKernelSurface, type BrowserAdapter } from "../browser/adapter.js";
import {
  hesitationMs,
  planClick,
  planSoftKeyType,
  planSwipe,
  planTap,
  planTyping,
} from "../browser/humanizer.js";
import type { Decision, DecisionPolicy } from "../cognition/cognition.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import {
  comparePrediction,
  errorSnippets,
  inferAppTheory,
  passiveText,
  visibleText,
} from "../cognition/mentalModel.js";
import { readingLoad, riskOf } from "../cognition/salience.js";
import { type Clock, SimulatedClock, WALL_CLOCK } from "../core/clock.js";
import { EventBus } from "../core/events.js";
import { type KernelPercept, kernelFromWebPercept } from "../core/kernel.js";
import { clamp01, createRng, type Rng, seedFromString } from "../core/random.js";
import type {
  Finding,
  LoopIteration,
  Percept,
  Point,
  Score,
  SessionUsage,
  Viewport,
} from "../core/types.js";
import { describeAction } from "../core/types.js";
import { appraise, decayRate } from "../emotion/appraisal.js";
import { EmotionalState, type EmotionSample } from "../emotion/emotionalState.js";
import { computeLearningMetrics, type LearningMetrics } from "../memory/learning.js";
import {
  type ApplicationMemory,
  appIdForUrl,
  applyForgetting,
  emptyApplicationMemory,
  type PersistentMemory,
  type SessionMemoryRecord,
} from "../memory/longTerm.js";
import { OperatorMemory, screenSignature } from "../memory/memory.js";
import { Observer } from "../observation/perception.js";
import {
  CULTURES,
  type CultureProfile,
  cultureOf,
  DEFAULT_CULTURE,
  withCulture,
} from "../personas/culture.js";
import { getPersona } from "../personas/library.js";
import type { Persona } from "../personas/persona.js";
import { createGoal, GoalStack } from "../planning/goals.js";
import { type EvePlugin, type PluginContext, PluginManager } from "../plugins/plugin.js";
import { computeScores } from "../scoring/scorer.js";
import { checkGeometry, checkPixels, checkRegression } from "../vision/analysis.js";
import type { DiscoveredWorkflow, WorkflowNode, WorkflowTransition } from "../workflow/graph.js";
import { WorkflowGraph } from "../workflow/graph.js";
import { type DiscoveredJourney, discoverJourney } from "../workflow/journeys.js";
import {
  type CognitiveConfig,
  type CognitiveLoadTimeline,
  CognitiveSuite,
  type ExpectationScore,
  type Fixation,
  type TrustSample,
} from "./cognitiveSuite.js";

/**
 * EveSession — one simulated human, one application, one sitting.
 *
 * Runs the human loop:
 *   Observe → Interpret → Update Mental Model → Predict → Decide → Interact
 *   → Observe Again → Compare Prediction vs Reality → Adjust Internal State
 *   → Continue
 *
 * The loop never follows a script: every step is decided fresh by the
 * cognition policy from the operator's current perception and internal state.
 */

export interface SessionOptions {
  adapter: BrowserAdapter;
  startUrl: string;
  /** Persona object or the name of a built-in persona. */
  persona?: Persona | string;
  policy?: DecisionPolicy;
  plugins?: readonly EvePlugin[];
  /** Task description; omit for open-ended exploration. */
  goal?: string;
  /** Signals whose appearance means the goal succeeded. */
  goalSuccessSignals?: readonly string[];
  seed?: number | string;
  maxSteps?: number;
  maxDurationMs?: number;
  viewport?: Viewport;
  /** Capture screenshots each step (needs a pixel-capable adapter). */
  screenshots?: boolean;
  /**
   * Multiplier applied to simulated human pauses when pacing the real
   * browser. 1 = real-time human speed; 0 = as fast as possible. The
   * simulated clock always advances at full human speed regardless.
   */
  paceScale?: number;
  /**
   * Model time instead of reading it.
   *
   * Off by default, because driving a real browser means waiting for real
   * latency. Turn it on when the surface under test is deterministic (a
   * `MockAdapter`, say) and the run has to be replayable: perceived latency,
   * the settle wait and the time budget then come from the simulated human
   * clock, so nothing about how busy the host machine was can reach the
   * operator's appraisal — and through it the session's score.
   */
  deterministic?: boolean;
  /** Log sink for progress lines. */
  onLog?: (line: string) => void;

  /* --- Phase-2 opt-in cognitive systems (default off → phase-1 behavior). --- */

  /**
   * Enable the enhanced cognitive suite: selective attention, cognitive-load
   * estimation, the trust model, and the expectation engine. `true` enables
   * all; pass an object to enable subsets. Off by default.
   */
  cognitive?: boolean | CognitiveConfig;
  /**
   * Persistent cross-session memory. When provided, the operator remembers
   * this application between sessions (layouts, paths, past frustrations) and
   * becomes more efficient over repeated runs.
   */
  longTermMemory?: PersistentMemory;
  /** Cultural profile (locale string or object) shaping reading direction etc. */
  culture?: CultureProfile | string;
}

export interface SessionResult {
  readonly startUrl: string;
  readonly personaName: string;
  readonly seed: number;
  readonly iterations: readonly LoopIteration[];
  readonly findings: readonly Finding[];
  readonly scores: readonly Score[];
  readonly emotionTimeline: readonly EmotionSample[];
  readonly workflows: readonly DiscoveredWorkflow[];
  readonly workflowNodes: readonly WorkflowNode[];
  readonly workflowTransitions: readonly WorkflowTransition[];
  readonly screenshots: readonly Buffer[];
  readonly usage: SessionUsage;
  readonly goalAchieved: boolean;
  readonly abandoned: boolean;
  readonly abandonReason: string | null;
  readonly endReason: string;
  readonly appTheory: string;
  /**
   * Advisories about the configured `goalSuccessSignals` — cases where a
   * signal was satisfied by text that does not evidence task completion.
   *
   * Goal success is decided by substring presence in visible screen text,
   * which is a proxy for task state rather than a measurement of it. These
   * warnings surface the cases where the proxy is most likely to mislead, so
   * a mis-chosen signal fails loudly instead of silently reporting success.
   * Empty when no signals are configured or none looked suspicious.
   */
  readonly goalSignalWarnings: readonly string[];

  /* --- Phase-2 additions. `capturedScreens` is always present (one
     representative percept per unique screen, screenshots stripped). The
     rest are populated only when the corresponding subsystem was enabled. --- */

  /** One representative percept per unique screen (screenshot buffers removed). */
  readonly capturedScreens: readonly Percept[];
  readonly culture: string;
  readonly trustTimeline?: readonly TrustSample[];
  readonly cognitiveLoad?: CognitiveLoadTimeline;
  readonly attention?: {
    fixations: Array<{ step: number; fixations: readonly Fixation[] }>;
    missedChanges: number;
  };
  readonly expectationTimeline?: readonly ExpectationScore[];
  /** The application's long-term memory *after* this session (if a store was used). */
  readonly longTermMemory?: ApplicationMemory;
  /** Cross-session learning metrics (if a store was used and history exists). */
  readonly learningMetrics?: LearningMetrics;
  /** The reconstructed user journey toward the goal. */
  readonly journey?: DiscoveredJourney;
}

export class EveSession {
  readonly events: EventBus;
  private readonly persona: Persona;
  private readonly policy: DecisionPolicy;
  private readonly rng: Rng;
  private readonly seed: number;
  private readonly plugins: PluginManager;
  private readonly options: Required<
    Pick<SessionOptions, "maxSteps" | "maxDurationMs" | "viewport" | "screenshots" | "paceScale">
  > &
    SessionOptions;
  private findings = new Map<string, Finding>();
  private findingCounter = 0;
  private screenshotGallery: Buffer[] = [];
  private lastShotBySignature = new Map<string, { shot: Buffer; text: string }>();
  private geometryCheckedSignatures = new Set<string>();
  /** Simulated human clock, ms. Advances by full human durations. */
  private simClock = 0;
  /**
   * Where elapsed time comes from. The same object the {@link Observer} reads,
   * so the operator and its eyes never disagree about what time it is.
   */
  private readonly clock: Clock;
  private readonly culture: CultureProfile;
  private readonly capturedScreens = new Map<string, Percept>();

  constructor(options: SessionOptions) {
    this.options = {
      maxSteps: options.maxSteps ?? 60,
      maxDurationMs: options.maxDurationMs ?? 10 * 60 * 1000,
      viewport: options.viewport ?? { width: 1280, height: 800 },
      screenshots: options.screenshots ?? false,
      paceScale: options.paceScale ?? 0.15,
      ...options,
    };
    this.clock = this.options.deterministic ? new SimulatedClock() : WALL_CLOCK;
    let persona =
      typeof options.persona === "string"
        ? getPersona(options.persona)
        : (options.persona ?? getPersona("first-time-user"));
    this.culture =
      typeof options.culture === "string"
        ? (CULTURES[options.culture] ?? DEFAULT_CULTURE)
        : (options.culture ?? cultureOf(persona));
    // Attach the resolved culture so downstream reads (attention direction,
    // localization checks) see a consistent profile.
    persona = withCulture(persona, this.culture);
    this.persona = persona;
    this.policy = options.policy ?? new HeuristicCognition();
    this.seed =
      typeof options.seed === "string"
        ? seedFromString(options.seed)
        : (options.seed ?? seedFromString(`${this.persona.name}:${options.startUrl}`));
    this.rng = createRng(this.seed);
    this.events = new EventBus((err, event) =>
      this.log(`listener error on ${event}: ${String(err)}`),
    );
    this.plugins = new PluginManager((err, plugin) =>
      this.log(`plugin "${plugin}" error: ${String(err)}`),
    );
    for (const plugin of options.plugins ?? []) this.plugins.register(plugin);
  }

  async run(): Promise<SessionResult> {
    const { adapter, startUrl } = this.options;
    const emotion = new EmotionalState(this.persona);
    const memory = new OperatorMemory(this.persona, this.rng);
    const goals = new GoalStack(
      createGoal(this.options.goal ?? "explore the application and understand what it offers", {
        successSignals: this.options.goalSuccessSignals,
      }),
    );
    const workflowGraph = new WorkflowGraph();
    const iterations: LoopIteration[] = [];
    const startedAt = this.clock.now();

    /* ---- Long-term memory: load, forget, seed the operator ---- */
    const appId = appIdForUrl(startUrl);
    let appMemory: ApplicationMemory | null = null;
    if (this.options.longTermMemory) {
      appMemory =
        (await this.options.longTermMemory.load(appId)) ??
        emptyApplicationMemory(appId, this.appNameFromUrl(startUrl));
      const currentSession = appMemory.sessionsCount + 1;
      applyForgetting(appMemory, currentSession, this.persona.traits.memoryRetention);
      // A returning operator recognizes remembered screens and starts with
      // familiarity-driven confidence.
      memory.seedFamiliarScreens(
        Object.values(appMemory.screens).map((s) => ({
          signature: s.signature,
          url: s.url,
          title: s.title,
          affordances: Object.keys(s.affordances),
        })),
      );
      for (const fact of Object.values(appMemory.facts)) {
        memory.learn({ kind: fact.kind, statement: fact.statement }, fact.confidence);
      }
      const familiarity = Math.min(1, retainedKnowledgeQuick(appMemory) / 8);
      if (familiarity > 0) {
        emotion.adjust("confidence", familiarity * 0.2);
        emotion.adjust("curiosity", -familiarity * 0.1);
        this.log(`(I've used this before — ${Math.round(familiarity * 100)}% familiar)`);
      }
    }

    /* ---- Enhanced cognitive suite ---- */
    const suite = this.options.cognitive
      ? new CognitiveSuite(this.persona, this.rng, appMemory, this.options.cognitive)
      : null;

    const pluginCtx: PluginContext = {
      persona: this.persona,
      startUrl,
      capabilities: adapter.capabilities,
      report: (f) => this.addFinding({ ...f, timestamp: this.simClock }),
    };

    await this.events.emit("session:start", {
      url: startUrl,
      personaName: this.persona.name,
      seed: this.seed,
    });
    await this.plugins.sessionStart(pluginCtx);

    // Surfaces whose perception depends on who is looking (a document's
    // comprehension) are told the operator before they open. Every other
    // adapter leaves the hook undefined and is unaffected.
    adapter.attachOperator?.(this.persona);
    await adapter.open(startUrl, this.options.viewport);
    const observer = new Observer(adapter, startedAt, this.clock);

    let endReason = "budget-exhausted";
    let abandoned = false;
    let abandonReason: string | null = null;
    let goalAchieved = false;
    let appTheory = "";
    let lastVia: string | null = null;
    let previousPercept: Percept | null = null;

    // De-duplicated: the same mis-chosen signal is re-evaluated on every
    // perception, and one advisory per session is the useful number.
    const goalSignalWarnings: string[] = [];
    // Set when the configured signals are already satisfied by the starting
    // screen; see the goal success check below.
    let goalSignalsUnusable = false;
    const recordGoalSignalWarning = (message: string): void => {
      if (goalSignalWarnings.includes(message)) return;
      goalSignalWarnings.push(message);
      this.log(`warning: ${message}`);
    };

    let step = 0;
    while (step < this.options.maxSteps) {
      // Deterministic mode measures the budget in modeled human time, so a
      // slow host cannot truncate the trajectory and change the score.
      if (this.clock.now() - startedAt > this.options.maxDurationMs) {
        endReason = "time-budget-exhausted";
        break;
      }

      /* ---- OBSERVE ------------------------------------------------ */
      const { percept, settleMs } = await observer.observe({
        withScreenshot: this.options.screenshots,
        settleTimeoutMs: 1000 + this.persona.traits.patience * 9000,
      });
      this.simClock = Math.max(this.simClock, percept.timestamp);
      await this.events.emit("loop:perceive", { percept, step });

      /* ---- INTERPRET / UPDATE MENTAL MODEL ------------------------ */
      const signature = screenSignature(percept);
      const prevSignature = previousPercept ? screenSignature(previousPercept) : null;
      // Error perception is modality-gated for the same reason the geometry
      // checks are: on a document surface there is nothing to retry or
      // dismiss, so prose *about* failures is not a failure the reader faces.
      const errorNow = errorSnippets(percept, adapter.capabilities.modality).length > 0;
      memory.observeScreen(percept, step);
      if (prevSignature && prevSignature !== signature && lastVia) {
        memory.recordTransition(prevSignature, signature, lastVia);
      }
      workflowGraph.observe(percept, step, lastVia, errorNow);
      if (!appTheory || memory.isNovelScreen(percept)) appTheory = inferAppTheory(percept);
      const dropped = memory.maybeForgetWorkingItem();
      if (dropped) this.log(`(mind wandered — forgot: ${dropped})`);
      memory.decayEpisodes();

      this.runVisionChecks(percept, signature);
      const screenshotIndex = this.storeScreenshot(percept, signature);
      this.captureScreen(percept, signature);
      await this.plugins.percept(pluginCtx, percept, step);

      /* ---- Enhanced perception: attention + cognitive load ---- */
      const goalKeywords = [...new Set([...goals.current.keywords, ...goals.root.keywords])];
      const stepPerception = suite ? suite.perceive(percept, previousPercept, goalKeywords) : null;
      const perceptForDecision = stepPerception?.perceptForDecision ?? percept;
      if (suite && !memory.isNovelScreen(percept)) {
        // Revisiting a known screen that looks the same reinforces consistency.
        suite.reinforceConsistency(true);
      }

      /* ---- goal success check ------------------------------------- */
      const text = visibleText(percept).toLowerCase();
      const goal = goals.root;
      const signalsPresent =
        goal.successSignals.length > 0 &&
        goal.successSignals.every((s) => text.includes(s.toLowerCase()));

      // Success signals are matched against *all* visible text — the page
      // title and every element's label included — so presence alone does not
      // distinguish "the operator accomplished this" from "these words happen
      // to be on screen". Two cases where that gap is widest are recorded as
      // advisories, and the first is refused outright.
      if (signalsPresent && step === 0) {
        // Satisfied by the starting screen, before the operator has acted.
        //
        // A condition that is already true when the session begins cannot
        // evidence that anything was accomplished — its truth carries no
        // information about the task. So the signal set is retired for the
        // whole session rather than merely deferred: delaying it by a step
        // would just move the same false success to the next perception,
        // since the text is typically still on screen.
        //
        // The usual cause is a word from the product's own name or tagline.
        // Previously this ended the session immediately, reporting
        // `goal-achieved` with zero interactions.
        goalSignalsUnusable = true;
        recordGoalSignalWarning(
          `success signal(s) [${goal.successSignals.join(", ")}] were already satisfied by the ` +
            `starting screen, before any action was taken. They cannot evidence completion and ` +
            `have been ignored for this session — the goal will be reported as not achieved. ` +
            `Choose text that appears only once the task is done.`,
        );
      }

      if (!goalAchieved && signalsPresent && !goalSignalsUnusable) {
        // A signal that no non-interactive text satisfies is being carried by
        // the label of a control the operator may never have activated —
        // "Export all" satisfying "export" while the export was never
        // performed. Not refused, because a label can legitimately be the only
        // wording of a completed state, but surfaced so the author can tell
        // the two apart.
        const passive = passiveText(percept).toLowerCase();
        const labelOnly = goal.successSignals.filter((s) => !passive.includes(s.toLowerCase()));
        if (labelOnly.length > 0) {
          recordGoalSignalWarning(
            `success signal(s) [${labelOnly.join(", ")}] were satisfied only by the label of an ` +
              `interactive element on ${percept.url}, not by any other visible text. If the ` +
              `operator never activated that control, this reports success for arriving at it.`,
          );
        }

        goalAchieved = true;
        goal.status = "achieved";
        endReason = "goal-achieved";
        this.log(`goal achieved: ${goal.description}`);
        await this.events.emit("goal:changed", { goal: goal.description, subgoal: null });
        break;
      }

      /* ---- error subgoal management ------------------------------- */
      if (errorNow && !goals.subgoal) {
        goals.push(
          createGoal("recover from the error on screen", {
            keywords: ["back", "retry", "again", "close", "dismiss", "ok"],
          }),
        );
        await this.events.emit("goal:changed", {
          goal: goals.root.description,
          subgoal: goals.current.description,
        });
      } else if (!errorNow && goals.subgoal?.description.includes("recover from the error")) {
        goals.resolve("achieved");
        await this.events.emit("goal:changed", { goal: goals.root.description, subgoal: null });
      }

      /* ---- PREDICT + DECIDE --------------------------------------- */
      // Phase 2: cognition receives the kernel view alongside the legacy
      // percept — the real thing on kernel-native surfaces, the projection
      // of the decision percept elsewhere (identical content either way).
      const kernelPercept = await this.kernelOf(adapter, perceptForDecision);
      const enrichment = suite ? suite.contextEnrichment(stepPerception?.load ?? null) : {};
      const decision = await this.policy.decide({
        percept: perceptForDecision,
        previousPercept,
        persona: this.persona,
        emotion: emotion.snapshot(),
        memory,
        goals,
        rng: this.rng,
        step,
        elapsedMs: this.simClock,
        kernel: kernelPercept,
        ...enrichment,
      });
      goals.tickEffort();
      await this.events.emit("loop:decide", {
        step,
        action: decision.action,
        rationale: decision.rationale,
        prediction: decision.prediction,
      });
      this.log(
        `#${step} [${goals.current.description.slice(0, 40)}] ${describeAction(decision.action)} — ${decision.rationale}`,
      );

      if (decision.action.kind === "abandon") {
        abandoned = true;
        abandonReason = decision.action.reason;
        endReason = "abandoned";
        this.addFinding({
          severity: "critical",
          category: "workflow",
          title: "The operator gave up",
          description: decision.action.reason,
          evidence: [
            `Persona: ${this.persona.name}`,
            `Goal: ${goals.root.description}`,
            `Final screen: ${percept.title || percept.url}`,
          ],
          url: percept.url,
          timestamp: this.simClock,
          screenshotIndex: screenshotIndex ?? undefined,
        });
        iterations.push(
          this.makeIteration(step, percept, goals, decision, null, emotion, screenshotIndex, null),
        );
        break;
      }

      /* ---- INTERACT ----------------------------------------------- */
      const actStart = this.clock.now();
      const clickPoint = await this.execute(adapter, decision, percept);
      lastVia = describeAction(decision.action);
      await this.events.emit("loop:act", { step, action: decision.action });

      /* ---- OBSERVE AGAIN + COMPARE -------------------------------- */
      const after = await observer.observe({
        withScreenshot: false,
        settleTimeoutMs: 1000 + this.persona.traits.patience * 9000,
      });
      const perceivedLatencyMs = this.clock.now() - actStart + settleMs;
      const outcome = comparePrediction(
        decision.prediction,
        percept,
        after.percept,
        perceivedLatencyMs,
        adapter.capabilities.modality,
      );
      await this.events.emit("loop:outcome", { step, outcome });

      /* ---- ADJUST INTERNAL STATE ---------------------------------- */
      const novelScreen = memory.isNovelScreen(after.percept);
      const madeProgress =
        outcome.screenChanged &&
        !outcome.errorPerceived &&
        (outcome.matchedSignals.length > 0 || novelScreen);
      appraise(emotion, this.persona, {
        outcome,
        madeProgress,
        novelScreen,
        cognitiveEffort: clamp01(decision.effort + readingLoad(after.percept) * 0.3),
      });
      emotion.decay(decayRate(this.persona, emotion.get("fatigue")));
      // Phase-2: trust model, expectation engine and fatigue feed back in.
      if (suite) suite.afterOutcome(decision, outcome, percept, after.percept, emotion, step);
      emotion.record(step, this.simClock);
      await this.events.emit("emotion:update", { emotion: emotion.snapshot(), step });

      /* ---- learn + remember --------------------------------------- */
      const episodeOutcome = outcome.errorPerceived
        ? "error"
        : outcome.prediction.expectsChange && !outcome.screenChanged
          ? "nothing"
          : outcome.surprise > 0.5
            ? "surprise"
            : "success";
      memory.recordEpisode(step, percept, decision.action, lastVia, episodeOutcome);
      this.learnFromOutcome(memory, decision, outcome, percept, after.percept);
      this.reportOutcomeFindings(decision, outcome, percept, screenshotIndex);
      await this.plugins.outcome(pluginCtx, outcome, after.percept, step);

      const iteration = this.makeIteration(
        step,
        percept,
        goals,
        decision,
        outcome,
        emotion,
        screenshotIndex,
        clickPoint,
      );
      iterations.push(iteration);
      await this.events.emit("loop:iteration", { iteration });

      previousPercept = after.percept;
      step += 1;
    }
    if (step >= this.options.maxSteps) endReason = "step-budget-exhausted";
    if (goalAchieved) endReason = "goal-achieved";
    if (abandoned) endReason = "abandoned";

    await this.plugins.sessionEnd(pluginCtx, iterations);
    await adapter.close();

    const usage: SessionUsage = {
      steps: iterations.length,
      durationMs: this.simClock,
      screensVisited: memory.knownScreens().reduce((n, s) => n + s.visits, 0),
      uniqueUrls: new Set(memory.knownScreens().map((s) => s.url)).size,
    };
    const findings = [...this.findings.values()].sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity),
    );
    const scores = computeScores({
      iterations,
      findings,
      emotionTimeline: emotion.timeline(),
      workflows: workflowGraph.discoveredWorkflows(),
      workflowNodes: workflowGraph.allNodes(),
      revisitRatio: workflowGraph.revisitRatio(),
      usage,
      goalAchieved,
      abandoned,
      // Phase 2 honesty layer: visual-only dimensions are skipped, not
      // vacuously passed, on textual surfaces.
      modality: adapter.capabilities.modality,
    });

    /* ---- Journey reconstruction ---- */
    const journey = discoverJourney(goals.root.description, iterations, workflowGraph, {
      goalAchieved,
      abandoned,
    });

    /* ---- Persist long-term memory + learning metrics ---- */
    let updatedMemory: ApplicationMemory | undefined;
    let learningMetrics: LearningMetrics | undefined;
    if (this.options.longTermMemory && appMemory) {
      this.updateLongTermMemory(appMemory, memory, workflowGraph, {
        persona: this.persona.name,
        goal: goals.root.description,
        usage,
        goalAchieved,
        abandoned,
        emotion,
        findings,
        scores,
      });
      await this.options.longTermMemory.save(appMemory);
      updatedMemory = appMemory;
      learningMetrics = computeLearningMetrics(appMemory);
    }

    await this.events.emit("session:end", {
      reason: endReason,
      steps: iterations.length,
      durationMs: usage.durationMs,
    });

    return {
      startUrl: this.options.startUrl,
      personaName: this.persona.name,
      seed: this.seed,
      iterations,
      findings,
      scores,
      emotionTimeline: emotion.timeline(),
      workflows: workflowGraph.discoveredWorkflows(),
      workflowNodes: workflowGraph.allNodes(),
      workflowTransitions: workflowGraph.allTransitions(),
      screenshots: this.screenshotGallery,
      usage,
      goalAchieved,
      abandoned,
      abandonReason,
      endReason,
      appTheory,
      goalSignalWarnings,
      capturedScreens: [...this.capturedScreens.values()],
      culture: this.culture.locale,
      trustTimeline: suite?.trustTimeline(),
      cognitiveLoad: suite?.cognitiveLoadTimeline() ?? undefined,
      attention: suite?.attentionSummary() ?? undefined,
      expectationTimeline: suite ? suite.expectationTimeline() : undefined,
      longTermMemory: updatedMemory,
      learningMetrics,
      journey,
    };
  }

  /** Store one screenshot-free representative percept per unique screen. */
  private captureScreen(percept: Percept, signature: string): void {
    if (this.capturedScreens.has(signature)) return;
    this.capturedScreens.set(signature, { ...percept, screenshot: null });
  }

  private appNameFromUrl(url: string): string {
    try {
      return new URL(url).host || url;
    } catch {
      return url.replace(/^mock:\/*/, "").split("/")[0] || url;
    }
  }

  /** Fold this session's experience into the persistent application memory. */
  private updateLongTermMemory(
    appMemory: ApplicationMemory,
    memory: OperatorMemory,
    graph: WorkflowGraph,
    ctx: {
      persona: string;
      goal: string;
      usage: SessionUsage;
      goalAchieved: boolean;
      abandoned: boolean;
      emotion: EmotionalState;
      findings: readonly Finding[];
      scores: readonly Score[];
    },
  ): void {
    const sessionNo = appMemory.sessionsCount + 1;
    appMemory.sessionsCount = sessionNo;

    // Merge spatial memory (screens + affordances) with reinforcement.
    for (const node of memory.knownScreens()) {
      const existing = appMemory.screens[node.signature] ?? {
        signature: node.signature,
        url: node.url,
        title: node.title,
        affordances: {},
        totalVisits: 0,
        lastSeenSession: sessionNo,
      };
      existing.url = node.url;
      existing.title = node.title;
      existing.totalVisits += node.visits;
      existing.lastSeenSession = sessionNo;
      for (const label of node.affordances) {
        existing.affordances[label] = Math.min(1, (existing.affordances[label] ?? 0) + 0.4);
      }
      appMemory.screens[node.signature] = existing;
    }
    for (const edge of graph.allTransitions()) {
      const key = `${edge.from}=>${edge.to}::${edge.via}`;
      const existing = appMemory.transitions[key] ?? {
        from: edge.from,
        to: edge.to,
        via: edge.via,
        traversals: 0,
      };
      existing.traversals += edge.count;
      appMemory.transitions[key] = existing;
    }
    // Merge semantic facts.
    for (const fact of memory.knownFacts()) {
      const key = `${fact.kind}:${fact.statement}`;
      const existing = appMemory.facts[key];
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.2);
        existing.reinforcements += 1;
        existing.lastSeenSession = sessionNo;
      } else {
        appMemory.facts[key] = { ...fact, lastSeenSession: sessionNo };
      }
      if (fact.kind === "shortcut" && !appMemory.knownShortcuts.includes(fact.statement)) {
        appMemory.knownShortcuts.push(fact.statement);
      }
    }
    // Favorite (completed) workflows.
    for (const wf of graph.discoveredWorkflows().filter((w) => w.completed)) {
      const fav = appMemory.favoriteWorkflows.find((f) => f.kind === wf.kind);
      if (fav) {
        fav.completions += 1;
        fav.lastSession = sessionNo;
      } else {
        appMemory.favoriteWorkflows.push({ kind: wf.kind, completions: 1, lastSession: sessionNo });
      }
    }
    appMemory.favoriteWorkflows.sort((a, b) => b.completions - a.completions);
    // Frustration spots.
    const frustratingFindings = ctx.findings.filter(
      (f) => f.severity === "critical" || f.severity === "major",
    );
    for (const f of frustratingFindings) {
      const sig = [...this.capturedScreens.values()].find((p) => p.url === f.url);
      const key = sig ? screenSignature(sig) : f.url;
      const spot = appMemory.frustrationSpots.find((s) => s.signature === key);
      if (spot) spot.occurrences += 1;
      else appMemory.frustrationSpots.push({ signature: key, title: f.url, occurrences: 1 });
    }

    const meanConfidence = ctx.emotion.mean("confidence");
    const peakFrustration = ctx.emotion.peak("frustration");
    const meanTrust = ctx.emotion.mean("trust");
    const outcomes = iterationsSurpriseRate(memory);
    const record: SessionMemoryRecord = {
      session: sessionNo,
      timestamp: new Date().toISOString(),
      persona: ctx.persona,
      goal: ctx.goal,
      steps: ctx.usage.steps,
      durationMs: ctx.usage.durationMs,
      goalAchieved: ctx.goalAchieved,
      abandoned: ctx.abandoned,
      confidence: Number(meanConfidence.toFixed(3)),
      frustration: Number(peakFrustration.toFixed(3)),
      trust: Number(meanTrust.toFixed(3)),
      errors: memory.errorCount(),
      surpriseRate: outcomes,
      overallScore: ctx.scores.find((s) => s.dimension === "overall")?.value ?? 0,
    };
    appMemory.history.push(record);
  }

  /* ---------------------------------------------------------------- */
  /* Action execution                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * The kernel view of a percept: the native kernel on kernel-capable
   * surfaces, the one-to-one projection of the legacy percept elsewhere.
   */
  private async kernelOf(adapter: BrowserAdapter, percept: Percept): Promise<KernelPercept> {
    const kernel = asKernelSurface(adapter);
    return kernel
      ? kernel.kernelPercept()
      : kernelFromWebPercept(percept, adapter.capabilities.modality);
  }

  private async execute(
    adapter: BrowserAdapter,
    decision: Decision,
    percept: Percept,
  ): Promise<Point | null> {
    const action = decision.action;
    switch (action.kind) {
      case "click":
      case "doubleClick": {
        const risk = riskOf(action.target);
        const hesitate = hesitationMs(risk, this.persona, this.rng);
        await this.pace(hesitate);
        const touch = adapter.capabilities.pointer === "touch";
        const gesture = touch
          ? planTap(action.target, this.persona, this.rng, this.options.viewport)
          : planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        // A touch has no persistent pointer to move ahead of the tap landing.
        if (!touch) await adapter.moveMouse(gesture.point);
        if (action.kind === "doubleClick") await adapter.doubleClickAt(gesture.point);
        else await adapter.clickAt(gesture.point);
        if (gesture.missed) {
          this.log(
            touch
              ? "(the tap missed and needed a correction)"
              : "(the click slipped and needed a correction)",
          );
        }
        return gesture.point;
      }
      case "hover": {
        if (!adapter.capabilities.canHover) {
          // No persistent pointer on this surface: hovering is not merely
          // awkward, it is unreachable. Don't fake a pointer move — the
          // accessibility plugin turns the attempt itself into a finding.
          this.log("(this surface has no hover — the affordance is unreachable)");
          return null;
        }
        const gesture = planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        await adapter.moveMouse(gesture.point);
        return gesture.point;
      }
      case "type": {
        const touch = adapter.capabilities.pointer === "touch";
        const gesture = touch
          ? planTap(action.target, this.persona, this.rng, this.options.viewport)
          : planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        if (!touch) await adapter.moveMouse(gesture.point);
        await adapter.clickAt(gesture.point);
        const plan = touch
          ? planSoftKeyType(action.text, this.persona, this.rng)
          : planTyping(action.text, this.persona, this.rng);
        // Real keystrokes: adapters handle per-char pacing; we simulate
        // corrections by sending Backspace for the "\b" marker.
        for (const key of plan.keystrokes) {
          if (key === "\b") await adapter.pressKey("Backspace");
          else await adapter.typeText(key, 0);
          await this.pace(plan.perCharIntervalMs);
        }
        if (plan.typoCount > 0) this.log(`(made and corrected ${plan.typoCount} typo(s))`);
        return gesture.point;
      }
      case "press":
        await this.pace(200);
        await adapter.pressKey(action.key);
        return null;
      case "scroll": {
        if (adapter.capabilities.pointer === "touch") {
          // A swipe is a flick plus decaying momentum, not one atomic jump.
          const swipe = planSwipe(action.deltaY, this.persona, this.rng);
          for (const segment of swipe.segments) {
            await this.pace(segment.durationMs);
            await adapter.scrollBy(segment.deltaY);
          }
        } else {
          await this.pace(300);
          await adapter.scrollBy(action.deltaY);
        }
        return null;
      }
      case "navigate":
        await this.pace(800);
        await adapter.navigate(action.url);
        return null;
      case "back":
        await this.pace(400);
        await adapter.goBack();
        return null;
      case "read":
      case "wait":
        await this.pace(action.durationMs);
        return null;
      case "abandon":
        return null;
      case "invoke": {
        // Phase 2: one kernel-native semantic act through the surface's own
        // verb registry — never decomposed into synthetic UI gestures.
        const kernel = asKernelSurface(adapter);
        if (!kernel) {
          // A kernel action on a legacy surface is a cognition bug; be
          // honest about it rather than faking pointer gestures.
          this.log(`(this surface cannot act on "${action.verb}" — no kernel actuator)`);
          return null;
        }
        await this.pace(500);
        await kernel.actKernel({ verb: action.verb, payload: action.payload });
        return null;
      }
    }
    void percept;
    return null;
  }

  /** Advance the simulated clock by full human time; sleep a scaled slice. */
  private async pace(humanMs: number): Promise<void> {
    this.simClock += humanMs;
    // The shared clock advances by the same full human duration, so perceived
    // latency and the time budget are measured in the same units the operator
    // thinks in. On a wall clock `advance` is a no-op and the sleep below is
    // what actually passes time.
    this.clock.advance(humanMs);
    if (this.clock.deterministic) return;
    const realMs = humanMs * this.options.paceScale;
    if (realMs >= 5) await new Promise((r) => setTimeout(r, Math.min(realMs, 4000)));
  }

  /* ---------------------------------------------------------------- */
  /* Findings & learning                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Geometry and pixel checks assume pixel geometry and visual styling are
   * meaningful. On a surface without them (`capabilities.spatial === false`)
   * they can only produce valid-but-trivial findings — character-cell boxes
   * flagged as tiny targets or clipped elements — so, exactly like the
   * plugins, the engine skips them rather than running and reporting them.
   * Skipped, not failed: a textual surface must never look like it failed a
   * visual audit.
   */
  private runVisionChecks(percept: Percept, signature: string): void {
    if (!this.options.adapter.capabilities.spatial) return;
    if (!this.geometryCheckedSignatures.has(signature)) {
      this.geometryCheckedSignatures.add(signature);
      for (const issue of checkGeometry(percept, this.persona.accessibility)) {
        this.addFinding({
          severity: issue.severityHint,
          category:
            issue.kind === "low-contrast" ||
            issue.kind === "tiny-text" ||
            issue.kind === "tiny-target"
              ? "accessibility"
              : "visual",
          title: issue.detail.split("—")[0]?.trim().slice(0, 90) ?? issue.kind,
          description: issue.detail,
          evidence: [`Screen: ${percept.title || percept.url}`, `Check: ${issue.kind}`],
          url: percept.url,
          timestamp: this.simClock,
        });
      }
      for (const issue of checkPixels(percept)) {
        this.addFinding({
          severity: issue.severityHint,
          category: issue.kind === "blank-screen" ? "visual" : "accessibility",
          title: issue.detail.split("—")[0]?.trim().slice(0, 90) ?? issue.kind,
          description: issue.detail,
          evidence: [`Screen: ${percept.title || percept.url}`, `Check: ${issue.kind}`],
          url: percept.url,
          timestamp: this.simClock,
        });
      }
    }
  }

  private storeScreenshot(percept: Percept, signature: string): number | null {
    if (!percept.screenshot) return null;
    const text = visibleText(percept);
    const previous = this.lastShotBySignature.get(signature);
    if (previous) {
      const regression = checkRegression(previous.shot, percept.screenshot, previous.text === text);
      if (regression) {
        this.addFinding({
          severity: regression.severityHint,
          category: "consistency",
          title: "Visual instability on revisit",
          description: regression.detail,
          evidence: [`Screen: ${percept.title || percept.url}`],
          url: percept.url,
          timestamp: this.simClock,
        });
      }
    }
    this.lastShotBySignature.set(signature, { shot: percept.screenshot, text });
    this.screenshotGallery.push(percept.screenshot);
    return this.screenshotGallery.length - 1;
  }

  private learnFromOutcome(
    memory: OperatorMemory,
    decision: Decision,
    outcome: ReturnType<typeof comparePrediction>,
    before: Percept,
    after: Percept,
  ): void {
    const action = decision.action;
    if (action.kind === "click" && outcome.screenChanged && !outcome.errorPerceived) {
      const label = action.target.text.trim();
      if (label) {
        memory.learn(
          {
            kind: "location",
            statement: `"${label}" on ${shortLocation(before.url)} leads to ${after.title || shortLocation(after.url)}`,
          },
          0.6,
        );
      }
    }
    if (action.kind === "click" && outcome.errorPerceived) {
      memory.learn(
        { kind: "warning", statement: `clicking "${action.target.text.trim()}" caused an error` },
        0.7,
      );
    }
    if (action.kind === "press" && outcome.screenChanged) {
      memory.learn({ kind: "shortcut", statement: `pressing ${action.key} works here` }, 0.5);
    }
  }

  private reportOutcomeFindings(
    decision: Decision,
    outcome: ReturnType<typeof comparePrediction>,
    percept: Percept,
    screenshotIndex: number | null,
  ): void {
    const actionText = describeAction(decision.action);
    if (outcome.errorPerceived) {
      this.addFinding({
        severity: "major",
        category: "error-recovery",
        title: `An error appeared after: ${actionText}`,
        description: `The operator performed a reasonable action (${actionText}) and was shown an error. Expected instead: ${outcome.prediction.description}`,
        evidence: [
          `Prediction confidence was ${(outcome.prediction.confidence * 100).toFixed(0)}%.`,
        ],
        url: percept.url,
        timestamp: this.simClock,
        screenshotIndex: screenshotIndex ?? undefined,
      });
    } else if (outcome.prediction.expectsChange && !outcome.screenChanged) {
      this.addFinding({
        severity: "major",
        category: "usability",
        title: `No visible response to: ${actionText}`,
        description:
          "The operator acted and nothing perceivably changed. Dead controls destroy confidence — users click again, then blame themselves, then leave.",
        evidence: [`Expected: ${outcome.prediction.description}`],
        url: percept.url,
        timestamp: this.simClock,
        screenshotIndex: screenshotIndex ?? undefined,
      });
    } else if (outcome.surprise > 0.7 && outcome.prediction.confidence > 0.55) {
      this.addFinding({
        severity: "minor",
        category: "expectation-violation",
        title: `Surprising result of: ${actionText}`,
        description: `The operator confidently expected "${outcome.prediction.description}" but the screen that followed didn't match (missed signals: ${outcome.missedSignals.join(", ") || "all"}).`,
        evidence: [
          `Surprise: ${(outcome.surprise * 100).toFixed(0)}%`,
          `Confidence before acting: ${(outcome.prediction.confidence * 100).toFixed(0)}%`,
        ],
        url: percept.url,
        timestamp: this.simClock,
        screenshotIndex: screenshotIndex ?? undefined,
      });
    }
  }

  private addFinding(finding: Omit<Finding, "id">): void {
    const key = `${finding.title}::${finding.url}`;
    if (this.findings.has(key)) return;
    this.findingCounter += 1;
    const full: Finding = { ...finding, id: `F-${String(this.findingCounter).padStart(3, "0")}` };
    this.findings.set(key, full);
    void this.events.emit("finding", { finding: full });
  }

  private makeIteration(
    step: number,
    percept: Percept,
    goals: GoalStack,
    decision: Decision,
    outcome: ReturnType<typeof comparePrediction> | null,
    emotion: EmotionalState,
    screenshotIndex: number | null,
    clickPoint: Point | null,
  ): LoopIteration {
    return {
      step,
      timestamp: this.simClock,
      url: percept.url,
      goal: goals.root.description,
      subgoal: goals.subgoal?.description ?? null,
      action: decision.action,
      actionDescription: describeAction(decision.action),
      rationale: decision.rationale,
      prediction: decision.prediction,
      outcome,
      emotion: emotion.snapshot() as unknown as Readonly<Record<string, number>>,
      screenshotIndex,
      clickPoint,
    };
  }

  private log(line: string): void {
    this.options.onLog?.(line);
  }
}

function severityRank(severity: Finding["severity"]): number {
  switch (severity) {
    case "critical":
      return 0;
    case "major":
      return 1;
    case "minor":
      return 2;
    case "info":
      return 3;
  }
}

function shortLocation(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === "/" ? u.host : u.pathname;
  } catch {
    return url.slice(0, 50);
  }
}

/** Quick familiarity proxy: total retained affordance/fact strength. */
function retainedKnowledgeQuick(memory: ApplicationMemory): number {
  let sum = 0;
  for (const screen of Object.values(memory.screens)) {
    for (const strength of Object.values(screen.affordances)) sum += strength;
  }
  for (const fact of Object.values(memory.facts)) sum += fact.confidence;
  return sum;
}

/** Surprise/error/dead-click rate from the operator's episodic memory. */
function iterationsSurpriseRate(memory: OperatorMemory): number {
  const eps = memory.recallEpisodes();
  if (eps.length === 0) return 0;
  const bad = eps.filter(
    (e) => e.outcome === "surprise" || e.outcome === "error" || e.outcome === "nothing",
  ).length;
  return Number((bad / eps.length).toFixed(3));
}
