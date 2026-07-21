import { EventBus } from "../core/events.js";
import {
  createRng,
  seedFromString,
  clamp01,
  type Rng,
} from "../core/random.js";
import type {
  Action,
  Finding,
  LoopIteration,
  Percept,
  Point,
  Score,
  SessionUsage,
  Viewport,
} from "../core/types.js";
import { describeAction } from "../core/types.js";
import type { BrowserAdapter } from "../browser/adapter.js";
import { planClick, planTyping, hesitationMs } from "../browser/humanizer.js";
import { Observer } from "../observation/perception.js";
import type { Persona } from "../personas/persona.js";
import { getPersona } from "../personas/library.js";
import { EmotionalState, type EmotionSample } from "../emotion/emotionalState.js";
import { appraise, decayRate } from "../emotion/appraisal.js";
import { OperatorMemory, screenSignature } from "../memory/memory.js";
import { GoalStack, createGoal } from "../planning/goals.js";
import type { DecisionPolicy, Decision } from "../cognition/cognition.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import {
  comparePrediction,
  errorSnippets,
  inferAppTheory,
  visibleText,
} from "../cognition/mentalModel.js";
import { riskOf, readingLoad } from "../cognition/salience.js";
import { checkGeometry, checkPixels, checkRegression } from "../vision/analysis.js";
import { WorkflowGraph } from "../workflow/graph.js";
import { PluginManager, type EvePlugin, type PluginContext } from "../plugins/plugin.js";
import { computeScores } from "../scoring/scorer.js";
import type { DiscoveredWorkflow, WorkflowNode, WorkflowTransition } from "../workflow/graph.js";

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
  /** Log sink for progress lines. */
  onLog?: (line: string) => void;
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

  constructor(options: SessionOptions) {
    this.options = {
      maxSteps: options.maxSteps ?? 60,
      maxDurationMs: options.maxDurationMs ?? 10 * 60 * 1000,
      viewport: options.viewport ?? { width: 1280, height: 800 },
      screenshots: options.screenshots ?? false,
      paceScale: options.paceScale ?? 0.15,
      ...options,
    };
    this.persona =
      typeof options.persona === "string"
        ? getPersona(options.persona)
        : options.persona ?? getPersona("first-time-user");
    this.policy = options.policy ?? new HeuristicCognition();
    this.seed =
      typeof options.seed === "string"
        ? seedFromString(options.seed)
        : options.seed ?? seedFromString(`${this.persona.name}:${options.startUrl}`);
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
    const wallStart = Date.now();

    const pluginCtx: PluginContext = {
      persona: this.persona,
      startUrl,
      report: (f) => this.addFinding({ ...f, timestamp: this.simClock }),
    };

    await this.events.emit("session:start", {
      url: startUrl,
      personaName: this.persona.name,
      seed: this.seed,
    });
    await this.plugins.sessionStart(pluginCtx);

    await adapter.open(startUrl, this.options.viewport);
    const observer = new Observer(adapter, wallStart);

    let endReason = "budget-exhausted";
    let abandoned = false;
    let abandonReason: string | null = null;
    let goalAchieved = false;
    let appTheory = "";
    let lastVia: string | null = null;
    let previousPercept: Percept | null = null;

    let step = 0;
    while (step < this.options.maxSteps) {
      if (Date.now() - wallStart > this.options.maxDurationMs) {
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
      const errorNow = errorSnippets(percept).length > 0;
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
      await this.plugins.percept(pluginCtx, percept, step);

      /* ---- goal success check ------------------------------------- */
      const text = visibleText(percept).toLowerCase();
      const goal = goals.root;
      if (
        !goalAchieved &&
        goal.successSignals.length > 0 &&
        goal.successSignals.every((s) => text.includes(s.toLowerCase()))
      ) {
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
      const decision = await this.policy.decide({
        percept,
        previousPercept,
        persona: this.persona,
        emotion: emotion.snapshot(),
        memory,
        goals,
        rng: this.rng,
        step,
        elapsedMs: this.simClock,
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
      const actStart = Date.now();
      const clickPoint = await this.execute(adapter, decision, percept);
      lastVia = describeAction(decision.action);
      await this.events.emit("loop:act", { step, action: decision.action });

      /* ---- OBSERVE AGAIN + COMPARE -------------------------------- */
      const after = await observer.observe({
        withScreenshot: false,
        settleTimeoutMs: 1000 + this.persona.traits.patience * 9000,
      });
      const perceivedLatencyMs = Date.now() - actStart + settleMs;
      const outcome = comparePrediction(
        decision.prediction,
        percept,
        after.percept,
        perceivedLatencyMs,
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
    });

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
    };
  }

  /* ---------------------------------------------------------------- */
  /* Action execution                                                  */
  /* ---------------------------------------------------------------- */

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
        const gesture = planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        await adapter.moveMouse(gesture.point);
        if (action.kind === "doubleClick") await adapter.doubleClickAt(gesture.point);
        else await adapter.clickAt(gesture.point);
        if (gesture.missed) this.log("(the click slipped and needed a correction)");
        return gesture.point;
      }
      case "hover": {
        const gesture = planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        await adapter.moveMouse(gesture.point);
        return gesture.point;
      }
      case "type": {
        const gesture = planClick(action.target, this.persona, this.rng);
        await this.pace(gesture.durationMs);
        await adapter.moveMouse(gesture.point);
        await adapter.clickAt(gesture.point);
        const plan = planTyping(action.text, this.persona, this.rng);
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
      case "scroll":
        await this.pace(300);
        await adapter.scrollBy(action.deltaY);
        return null;
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
    }
    void percept;
    return null;
  }

  /** Advance the simulated clock by full human time; sleep a scaled slice. */
  private async pace(humanMs: number): Promise<void> {
    this.simClock += humanMs;
    const realMs = humanMs * this.options.paceScale;
    if (realMs >= 5) await new Promise((r) => setTimeout(r, Math.min(realMs, 4000)));
  }

  /* ---------------------------------------------------------------- */
  /* Findings & learning                                               */
  /* ---------------------------------------------------------------- */

  private runVisionChecks(percept: Percept, signature: string): void {
    if (!this.geometryCheckedSignatures.has(signature)) {
      this.geometryCheckedSignatures.add(signature);
      for (const issue of checkGeometry(percept, this.persona.accessibility)) {
        this.addFinding({
          severity: issue.severityHint,
          category:
            issue.kind === "low-contrast" || issue.kind === "tiny-text" || issue.kind === "tiny-target"
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
      memory.learn(
        { kind: "shortcut", statement: `pressing ${action.key} works here` },
        0.5,
      );
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
        evidence: [`Prediction confidence was ${(outcome.prediction.confidence * 100).toFixed(0)}%.`],
        url: percept.url,
        timestamp: this.simClock,
        screenshotIndex: screenshotIndex ?? undefined,
      });
    } else if (outcome.prediction.expectsChange && !outcome.screenChanged) {
      this.addFinding({
        severity: "major",
        category: "usability",
        title: `No visible response to: ${actionText}`,
        description: `The operator acted and nothing perceivably changed. Dead controls destroy confidence — users click again, then blame themselves, then leave.`,
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
