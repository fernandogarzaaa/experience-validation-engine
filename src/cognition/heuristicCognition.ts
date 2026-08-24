import type { SurfaceSignal } from "../core/kernel.js";
import { clamp01 } from "../core/random.js";
import type { Action, VisibleElement } from "../core/types.js";
import { screenSignature } from "../memory/memory.js";
import { abandonmentThreshold, readingTimeMs } from "../personas/persona.js";
import {
  type ExplorationStrategy,
  type StrategyWeights,
  strategyWeights,
} from "../planning/strategies.js";
import type { CognitiveContext, Decision, DecisionPolicy } from "./cognition.js";
import { predictInteraction, tokenize } from "./mentalModel.js";
import { choiceLoad, readingLoad, scoreAffordances } from "./salience.js";
import { synthesizeArguments } from "./toolArgs.js";

/**
 * The default, fully-offline decision policy.
 *
 * Models a human's moment-to-moment choice as a priority cascade — the same
 * one people actually run:
 *
 *  1. Something is blocking me (dialog) → deal with it.
 *  2. The page is still loading → wait (patience permitting).
 *  3. I'm too frustrated to continue → give up.
 *  4. I haven't looked at this screen yet → read it first.
 *  5. There's a field the task needs filled → fill it.
 *  6. Something looks worth clicking → click the most salient thing.
 *  7. There's more page below → scroll.
 *  8. I'm going in circles → go back.
 *  9. Nothing left → step back or give up.
 *
 * On a document surface (`src/humanity/`) the priorities are a reader's
 * rather than an operator's, and {@link HeuristicCognition.handleDocumentSurface}
 * runs its own cascade instead. In a dialogue (`src/conversation/`) they are
 * a speaker's, and {@link HeuristicCognition.handleConversationSurface} runs
 * that one.
 *
 * All stochastic choices go through the session RNG so runs are reproducible.
 */
export class HeuristicCognition implements DecisionPolicy {
  readonly name: string = "heuristic";

  constructor(private readonly strategy: ExplorationStrategy = "curious") {}

  async decide(ctx: CognitiveContext): Promise<Decision> {
    const { percept, persona, emotion, memory, goals, rng } = ctx;
    const sig = screenSignature(percept);
    const effortBase = clamp01(readingLoad(percept) * 0.5 + choiceLoad(percept) * 0.5);
    const weights = strategyWeights(this.strategy);

    // 0. Kernel-native tool surface (Phase 2): one tool call is one semantic
    //    act, typed signals replace the dialog metaphor. Only fires when the
    //    kernel percept advertises tool affordances; web/CLI percepts never
    //    do, so the cascade below is byte-for-byte the phase-1 behavior.
    const toolSurfaceDecision = this.handleToolSurface(ctx, sig);
    if (toolSurfaceDecision) return toolSurfaceDecision;

    // 0b. Kernel-native document surface (the humanity seam): reading is its
    //     own cascade, not clicking with different words. Only fires when the
    //     kernel percept is a document, so web/CLI/MCP behavior is unchanged.
    const documentDecision = this.handleDocumentSurface(ctx, sig);
    if (documentDecision) return documentDecision;

    // 0c. Kernel-native conversational surface (the dialogue seam): talking
    //     is its own cascade — the only one where the surface can fail to
    //     understand the operator. Fires only on a conversational kernel.
    const conversationDecision = this.handleConversationSurface(ctx);
    if (conversationDecision) return conversationDecision;

    // 1. A dialog is blocking the screen.
    const dialogDecision = this.handleDialog(ctx);
    if (dialogDecision) return dialogDecision;

    // 2. Loading indicator: wait, but patience is finite.
    if (percept.loadingIndicator) {
      const waitMs = 500 + persona.traits.patience * 2500;
      return {
        action: { kind: "wait", durationMs: waitMs },
        rationale: "The page is still loading; I'll give it a moment.",
        prediction: {
          description: "The spinner should be gone when I look again.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.7,
        },
        effort: 0.05,
      };
    }

    // 3. Emotional bailout.
    if (emotion.frustration >= abandonmentThreshold(persona)) {
      return {
        action: {
          kind: "abandon",
          reason: `Frustration (${emotion.frustration.toFixed(2)}) exceeded tolerance while trying to ${goals.current.description}.`,
        },
        rationale: "I've had enough. This isn't working and I'm done trying.",
        prediction: {
          description: "I stop using the product.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    // 4. First encounter with a screen: read it before touching anything.
    const readKey = `read:${sig}`;
    const alreadyRead = memory.currentThoughts().some((t) => t.content === readKey);
    if (!alreadyRead && memory.isNovelScreen(percept)) {
      memory.hold(readKey, ctx.step);
      const words = percept.elements.reduce(
        (n, el) => n + el.text.split(/\s+/).filter(Boolean).length,
        0,
      );
      const durationMs = readingTimeMs(persona, Math.min(words, 400));
      return {
        action: { kind: "read", target: null, durationMs },
        rationale: "New screen — let me look around and figure out what this is.",
        prediction: {
          description: "Reading won't change anything; I'm building a picture.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 0.95,
        },
        effort: clamp01(effortBase + 0.2),
      };
    }

    const goalKeywords = [...new Set([...goals.current.keywords, ...goals.root.keywords])];

    // 5a. Strong goal match wins over habit: if something on screen plainly
    // matches what I'm trying to do ("Forgot password?" while trying to
    // reset a password), act on it before reflexively filling forms.
    const preScored = scoreAffordances(ctx, goalKeywords);
    const goalHit = preScored.find(
      (s) => s.goalRelevance >= 0.5 && s.novelty > 0 && !s.element.editable && s.risk < 0.6,
    );
    if (goalHit) {
      memory.markTried(sig, goalHit.element.text);
      return {
        action: { kind: "click", target: goalHit.element },
        rationale: `"${goalHit.element.text.trim()}" is exactly what I'm looking for (${goals.current.description}).`,
        prediction: predictInteraction(goalHit.element, "click", this.baseConfidence(ctx)),
        effort: effortBase,
      };
    }

    // 5. Fill a goal-relevant empty field, if one is visible.
    const fieldDecision = this.handleFormField(ctx, goalKeywords);
    if (fieldDecision) return fieldDecision;

    // 5b. Form completion instinct: having just filled a form, a human's
    // next move is the form's submit button — not wandering off to a link.
    const submitDecision = this.handleFormSubmit(ctx);
    if (submitDecision) return submitDecision;

    // 6. Pick an affordance to act on. Extracted into a protected hook so
    //    alternative decision models (e.g. the utility-based policy) can
    //    override just this step while reusing the whole cascade.
    const affordanceDecision = this.chooseAffordance(ctx, goalKeywords, weights, effortBase, sig);
    if (affordanceDecision) return affordanceDecision;

    // 7. More page below the fold?
    const canScrollDown = percept.scrollY + percept.viewport.height < percept.scrollHeight - 40;
    if (canScrollDown && rng.chance(0.5 + weights.surveyBias)) {
      return {
        action: { kind: "scroll", deltaY: Math.round(percept.viewport.height * 0.8) },
        rationale: "Nothing useful up here — maybe there's more further down.",
        prediction: {
          description: "Scrolling should reveal more of the page.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.85,
        },
        effort: 0.05,
      };
    }

    // 8. Going in circles → retreat.
    if (memory.loopingScore() > 0.5 || !canScrollDown) {
      const trail = memory.trail();
      if (trail.length > 1) {
        return {
          action: { kind: "back" },
          rationale: "I keep ending up in the same place. Backtracking to try another route.",
          prediction: {
            description: "The previous screen should reappear.",
            expectedSignals: [],
            expectsChange: true,
            confidence: 0.8,
          },
          effort: 0.1,
        };
      }
    }

    // 9. Dead end.
    return {
      action: {
        kind: "abandon",
        reason: "No visible way to make progress — the screen offers nothing actionable.",
      },
      rationale: "There's nothing here I can act on. I'm stuck.",
      prediction: {
        description: "I stop using the product.",
        expectedSignals: [],
        expectsChange: false,
        confidence: 1,
      },
      effort: 0.1,
    };
  }

  /* ---------------------------------------------------------------- */

  /**
   * Choose which visible affordance to act on. The default implementation is
   * salience-driven softmax selection (phase-1 behavior, unchanged).
   * Subclasses may override to substitute a different decision model.
   */
  protected chooseAffordance(
    ctx: CognitiveContext,
    goalKeywords: readonly string[],
    weights: StrategyWeights,
    effortBase: number,
    sig: string,
  ): Decision | null {
    const { persona, emotion, memory, goals, rng } = ctx;
    const scored = scoreAffordances(ctx, goalKeywords).filter((s) => {
      // Anxious/low-risk personas refuse plainly destructive controls.
      if (s.risk >= 1 && persona.traits.riskTolerance < 0.2) return false;
      return true;
    });

    const viable = scored.filter((s) => s.total > 0.05);
    if (viable.length === 0) return null;

    // Attention span controls how far down the salience list the eye wanders.
    const considered = viable.slice(
      0,
      Math.max(1, Math.round(2 + (1 - persona.traits.attentionSpan) * 4)),
    );
    const chosen = rng.weightedPick(
      considered,
      considered.map((s) => Math.exp(s.total * (1 + weights.goalWeight))),
    );
    const el = chosen.element;
    memory.markTried(sig, el.text);

    // Keyboard-first personas prefer pressing Enter on focused controls.
    if (
      persona.accessibility.keyboardOnly ||
      (persona.traits.keyboardPreference > 0.7 && el.focused)
    ) {
      if (el.focused) {
        return {
          action: { kind: "press", key: "Enter" },
          rationale: `"${el.text.trim()}" is focused; Enter should activate it.`,
          prediction: predictInteraction(el, "click", this.baseConfidence(ctx)),
          effort: effortBase,
        };
      }
      if (persona.accessibility.keyboardOnly) {
        return {
          action: { kind: "press", key: "Tab" },
          rationale: "I only use the keyboard — tabbing toward the control I want.",
          prediction: {
            description: "Focus should move to the next control with a visible focus ring.",
            expectedSignals: [],
            expectsChange: false,
            confidence: 0.75,
          },
          effort: effortBase + 0.1,
        };
      }
    }

    const hesitant =
      chosen.risk > 0.4 && (persona.traits.riskTolerance < 0.4 || emotion.confidence < 0.4);
    const rationale = hesitant
      ? `"${el.text.trim()}" looks consequential… but it seems like the way forward, so carefully clicking it.`
      : chosen.goalRelevance > 0.4
        ? `"${el.text.trim()}" matches what I'm trying to do (${goals.current.description}).`
        : chosen.novelty > 0
          ? `I haven't tried "${el.text.trim()}" yet — curious what it does.`
          : `"${el.text.trim()}" is the most promising thing on screen.`;

    return {
      action: { kind: "click", target: el },
      rationale,
      prediction: predictInteraction(el, "click", this.baseConfidence(ctx)),
      effort: clamp01(effortBase + (hesitant ? 0.2 : 0)),
    };
  }

  protected baseConfidence(ctx: CognitiveContext): number {
    return clamp01(0.3 + ctx.persona.traits.techLiteracy * 0.4 + ctx.emotion.confidence * 0.3);
  }

  /* ---------------------------------------------------------------- */
  /* Kernel-native tool surfaces (Phase 2, MCP)                        */
  /* ---------------------------------------------------------------- */

  /**
   * Decide natively on a kernel tool surface — the Phase-2 replacement for
   * the Phase-1 projection (a tool call was "form fill + Enter"; an error
   * was a fake modal dialog; arguments were typed text re-parsed by the
   * adapter — projection debt ledger items 1, 3, 4).
   *
   * Returns null unless the kernel percept advertises `mcp.tool`
   * affordances, so legacy surfaces never enter this branch. Inside it, the
   * same human priorities apply, restated natively: a dead surface ends the
   * session; a busy surface is waited out; a new catalog is read before
   * anything is touched; a failure is *read*, not "dismissed"; and choosing
   * a tool produces exactly one `mcp.invoke` action with typed arguments.
   */
  private handleToolSurface(ctx: CognitiveContext, sig: string): Decision | null {
    const kernel = ctx.kernel;
    if (kernel?.modality !== "textual") return null;
    const tools = kernel.affordances.filter((a) => a.kind === "mcp.tool" && a.state.enabled);
    if (tools.length === 0) return null;
    const { percept, persona, memory, goals, rng } = ctx;

    // The surface itself ceased to exist — not a screen without affordances.
    if (kernel.signals.some((s) => s.type === "surface-terminated")) {
      return {
        action: {
          kind: "abandon",
          reason: "The MCP server connection terminated mid-session; the surface is gone.",
        },
        rationale: "The server is gone — there is nothing left to operate.",
        prediction: {
          description: "I stop using the product.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    // A call in flight: wait, patience permitting (same as the loading rule).
    if (kernel.signals.some((s) => s.type === "loading" && s.active)) {
      const waitMs = 500 + persona.traits.patience * 2500;
      return {
        action: { kind: "wait", durationMs: waitMs },
        rationale: "A tool call is still running; I'll give it a moment.",
        prediction: {
          description: "The call should have finished when I look again.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.7,
        },
        effort: 0.05,
      };
    }

    const thoughts = () => memory.currentThoughts().map((t) => t.content);

    // A failed call is an error to *read*, not a modal to dismiss.
    const failure = [...kernel.signals].reverse().find(isFailureSignal);
    if (failure) {
      const failureText = failure.text;
      const readKey = `mcp-error-read:${failureText.slice(0, 80)}`;
      if (!thoughts().includes(readKey)) {
        memory.hold(readKey, ctx.step);
        return {
          action: { kind: "read", target: null, durationMs: readingTimeMs(persona, 60) },
          rationale: `The call failed ("${failureText.slice(0, 60)}") — reading what the server said before trying anything else.`,
          prediction: {
            description: "Reading the error changes nothing; I'm deciding what to try next.",
            expectedSignals: [],
            expectsChange: false,
            confidence: 0.9,
          },
          effort: 0.2,
        };
      }
    }

    // First encounter with a screen: read it before touching anything (the
    // same instinct as the cascade's read-first rule, restated here because
    // this branch supersedes the cascade on tool surfaces).
    if (!failure) {
      const readKey = `read:${sig}`;
      const alreadyRead = memory.currentThoughts().some((t) => t.content === readKey);
      if (!alreadyRead && memory.isNovelScreen(percept)) {
        memory.hold(readKey, ctx.step);
        const words = percept.elements.reduce(
          (n, el) => n + el.text.split(/\s+/).filter(Boolean).length,
          0,
        );
        const durationMs = readingTimeMs(persona, Math.min(words, 400));
        return {
          action: { kind: "read", target: null, durationMs },
          rationale: "New screen — let me look around and figure out what this is.",
          prediction: {
            description: "Reading won't change anything; I'm building a picture.",
            expectedSignals: [],
            expectsChange: false,
            confidence: 0.95,
          },
          effort: 0.3,
        };
      }
    }

    // Choose a tool to call. Tools are tried at most once per session
    // (working memory); goal-relevant ones win over curiosity.
    const triedKey = (id: string) => `mcp-tried:${id}`;
    const untried = tools.filter((t) => !thoughts().includes(triedKey(t.id)));
    if (untried.length === 0) return null; // explored everything → cascade tail

    const goalKeywords = [...new Set([...goals.current.keywords, ...goals.root.keywords])];
    const goalHit = untried.find((t) => {
      const tokens = tokenize(`${toolNameOf(t)} ${t.description}`);
      return goalKeywords.some((kw) => tokens.includes(kw));
    });
    const chosen = goalHit ?? rng.pick(untried);
    const toolName = toolNameOf(chosen);
    memory.hold(triedKey(chosen.id), ctx.step);

    // Typed arguments, synthesized from the schema the server advertises —
    // intent is a cognition decision, not adapter-side text coercion.
    const schema = chosen.state.metadata?.inputSchema as
      | Readonly<Record<string, unknown>>
      | undefined;
    const args = synthesizeArguments(schema, persona.name, rng);

    return {
      action: {
        kind: "invoke",
        verb: "mcp.invoke",
        target: null,
        payload: { tool: toolName, arguments: args },
      },
      rationale: goalHit
        ? `"${toolName}" matches what I'm trying to do (${goals.current.description}) — calling it.`
        : `I haven't tried "${toolName}" yet — let me call it and see what it does.`,
      prediction: {
        description: `Calling ${toolName} should return a result.`,
        expectedSignals: [toolName],
        expectsChange: true,
        confidence: this.baseConfidence(ctx),
      },
      effort: 0.3,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Kernel-native document surfaces (the humanity seam)               */
  /* ---------------------------------------------------------------- */

  /**
   * Decide natively on a document surface (`src/humanity/`) — the reading
   * cascade, which is a different cascade from the operating one.
   *
   * A person driving software asks "what can I click"; a person reading asks
   * "do I understand this, and is it worth going on". So the priorities are
   * the reader's own:
   *
   *  1. I reached the end — I am done, not stuck.
   *  2. I'm too frustrated to keep reading → put it down.
   *  3. I did not follow that → read it again, if I have the patience.
   *  4. Something here answers what I came for → study it.
   *  5. I haven't read this {section} yet → skim or read it, by thoroughness.
   *  6. A reference leads where I'm trying to go → follow it.
   *  7. There is more → turn the page.
   *
   * Returns null unless the kernel percept is a document, so no existing
   * surface enters this branch and every legacy cascade is untouched.
   */
  private handleDocumentSurface(ctx: CognitiveContext, sig: string): Decision | null {
    const kernel = ctx.kernel;
    if (kernel?.modality !== "document") return null;
    const { persona, emotion, memory, goals, rng } = ctx;

    const sectionKey = `read:${kernel.frame.address}#${kernel.section}`;
    const alreadyRead = memory.currentThoughts().some((t) => t.content === sectionKey);
    const words = kernel.blocks.reduce(
      (total, block) => total + block.text.split(/\s+/).filter(Boolean).length,
      0,
    );
    const gaps = kernel.signals.filter(
      (s): s is Extract<SurfaceSignal, { type: "comprehension-gap" }> =>
        s.type === "comprehension-gap",
    );

    // 1. The end of the artifact. Finishing is an outcome, not an exit — but
    //    a reader who finishes without what they came for does not sit on the
    //    last page. They go back and look again, once, and then they stop.
    const end = kernel.signals.find(
      (s): s is Extract<SurfaceSignal, { type: "end-of-content" }> => s.type === "end-of-content",
    );
    if (end) {
      const timesHere =
        memory.knownScreens().find((screen) => screen.signature === sig)?.visits ?? 1;
      if (timesHere <= 1) {
        return {
          action: { kind: "read", target: null, durationMs: readingTimeMs(persona, 20) },
          rationale: `That's the end. I've read all ${kernel.sectionCount} ${kernel.sectionNoun}s.`,
          prediction: {
            description: "There is nothing after this.",
            expectedSignals: [end.label],
            expectsChange: false,
            confidence: 0.95,
          },
          effort: 0.05,
        };
      }
      if (timesHere === 2 && kernel.section > 0) {
        return {
          action: { kind: "invoke", verb: "doc.back", target: null },
          rationale: `I got to the end and I still don't have what I came for (${goals.current.description}) — going back through it.`,
          prediction: {
            description: "Somewhere earlier said what I need.",
            expectedSignals: [],
            expectsChange: true,
            confidence: 0.4,
          },
          effort: 0.25,
        };
      }
      return {
        action: {
          kind: "abandon",
          reason: `Read the whole ${kernel.sectionNoun === "slide" ? "deck" : "artifact"} and it never answered: ${goals.root.description}.`,
        },
        rationale: "I've read it all, twice. It doesn't say what I needed to know.",
        prediction: {
          description: "I stop reading.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    // 2. Reading has a breaking point too — it is just quieter than a rage
    //    quit. People put documents down and never come back to them.
    if (emotion.frustration >= abandonmentThreshold(persona)) {
      return {
        action: {
          kind: "abandon",
          reason: `Gave up reading at ${kernel.sectionNoun} ${kernel.section + 1} of ${kernel.sectionCount}: too much of this isn't landing.`,
        },
        rationale: "I've read the same thing three times and I still don't follow it. I'm done.",
        prediction: {
          description: "I stop reading.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    // 3. Something did not land. A thorough, patient reader goes back over
    //    it; a skimmer shrugs and moves on — which is the difference that
    //    makes an unexplained term expensive for some readers and free for
    //    others.
    const rereadKey = `reread:${kernel.frame.address}#${kernel.section}`;
    const alreadyReread = memory.currentThoughts().some((t) => t.content === rereadKey);
    if (gaps.length > 0 && !alreadyReread) {
      const persistence = persona.traits.thoroughness * 0.6 + persona.traits.patience * 0.4;
      if (rng.next() < persistence) {
        memory.hold(rereadKey, ctx.step);
        const gap = gaps[0] as Extract<SurfaceSignal, { type: "comprehension-gap" }>;
        return {
          action: {
            kind: "invoke",
            verb: "doc.reread",
            target: null,
          },
          rationale: `I didn't follow that — ${gap.text}. Let me read it again.`,
          prediction: {
            description: "A second pass should make it clearer.",
            expectedSignals: [],
            expectsChange: false,
            confidence: 0.45,
          },
          effort: clamp01(0.35 + words / 400),
        };
      }
    }

    // 4. Something on this page answers what I came for. Tables, figures and
    //    numbers are the things a reader stops *on*, so a goal-matching one
    //    gets studied rather than skated past.
    const goalKeywords = [...new Set([...goals.current.keywords, ...goals.root.keywords])];
    const studyTarget = kernel.affordances.find((a) => {
      if (!STUDYABLE.has(a.kind)) return false;
      if (memory.currentThoughts().some((t) => t.content === `studied:${a.id}`)) return false;
      const tokens = tokenize(a.description);
      return goalKeywords.some((keyword) => tokens.includes(keyword));
    });
    if (studyTarget) {
      memory.hold(`studied:${studyTarget.id}`, ctx.step);
      return {
        action: { kind: "invoke", verb: "doc.study", target: null, payload: studyTarget.id },
        rationale: `This looks like what I'm after (${goals.current.description}) — let me work through it.`,
        prediction: {
          description: `Studying "${truncateLabel(studyTarget.description)}" should tell me what it's claiming.`,
          expectedSignals: goalKeywords,
          expectsChange: false,
          confidence: this.baseConfidence(ctx),
        },
        effort: 0.4,
      };
    }

    // 5. Unread content in front of me. Thorough readers read; skimmers skim
    //    — and a skimmer genuinely does not perceive what they skipped, which
    //    is why the two produce different findings on the same artifact.
    if (!alreadyRead) {
      memory.hold(sectionKey, ctx.step);
      const skims = rng.next() > persona.traits.thoroughness && words > 40;
      return {
        action: {
          kind: "invoke",
          verb: skims ? "doc.skim" : "doc.read",
          target: null,
        },
        rationale: skims
          ? `${words} words — I'll skim this ${kernel.sectionNoun} for anything that matters.`
          : `Reading "${kernel.frame.label}".`,
        prediction: {
          description: skims
            ? "Skimming should tell me whether this is worth reading properly."
            : "Reading this should tell me what it says.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 0.8,
        },
        effort: clamp01(0.15 + words / 500),
      };
    }

    // 6. A cross-reference pointing where I'm trying to get to.
    const reference = kernel.affordances.find((a) => {
      if (a.kind !== "doc.reference") return false;
      if (memory.currentThoughts().some((t) => t.content === `followed:${a.id}`)) return false;
      const tokens = tokenize(a.description);
      return goalKeywords.some((keyword) => tokens.includes(keyword));
    });
    if (reference) {
      memory.hold(`followed:${reference.id}`, ctx.step);
      return {
        action: { kind: "invoke", verb: "doc.follow", target: null, payload: reference.id },
        rationale: `"${truncateLabel(reference.description)}" should lead to what I'm looking for.`,
        prediction: {
          description: "Following this should take me somewhere relevant.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.6,
        },
        effort: 0.2,
      };
    }

    // 7. Turn the page.
    return {
      action: { kind: "invoke", verb: "doc.next", target: null },
      rationale: `Done with this ${kernel.sectionNoun} — moving on.`,
      prediction: {
        description: `The next ${kernel.sectionNoun} should follow on from this one.`,
        expectedSignals: [],
        expectsChange: true,
        confidence: 0.85,
      },
      effort: 0.1,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Kernel-native conversational surfaces (the dialogue seam)         */
  /* ---------------------------------------------------------------- */

  /**
   * Decide natively in a dialogue (`src/conversation/`) — the talking
   * cascade, which is neither the operating one nor the reading one.
   *
   * Someone driving software asks "what can I click"; someone reading asks
   * "do I understand this"; someone in a conversation asks a third thing:
   * **"did it understand *me*, and is it worth trying again?"** That question
   * has no analogue on any other surface, and the answer is what the whole
   * experience turns on:
   *
   *  1. It's still typing → wait, but patience is finite.
   *  2. It's gone → nothing left to talk to.
   *  3. I've had enough → leave.
   *  4. It didn't get me → say it differently, while I still have the will.
   *  5. I've rephrased too many times → ask for a human.
   *  6. It won't help and offered a way out → take it.
   *  7. I haven't said anything yet → open with what I came for.
   *  8. It answered → follow up on what's still missing.
   *
   * Returns null unless the kernel percept is a conversation, so no existing
   * surface enters this branch and every other cascade is untouched.
   */
  private handleConversationSurface(ctx: CognitiveContext): Decision | null {
    const kernel = ctx.kernel;
    if (kernel?.modality !== "conversational") return null;
    const { persona, emotion, memory, goals, rng } = ctx;

    // 1. It is composing. Waiting on a bot is not like waiting on a page:
    //    there is a person on the other end of the metaphor, so people give
    //    it longer — and resent it more when nothing comes.
    //
    //    Backends that answer within one `actKernel` call never surface this
    //    state to the loop, because the reply has already landed by the time
    //    the next percept is taken. It is reached by surfaces that report
    //    progress asynchronously — a streaming endpoint, or a bot that posts
    //    "typing…" before it answers.
    if (kernel.awaitingReply) {
      const waitMs = 800 + persona.traits.patience * 4000;
      return {
        action: { kind: "wait", durationMs: waitMs },
        rationale: "It's typing — I'll give it a moment.",
        prediction: {
          description: "It should answer in a second.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.7,
        },
        effort: 0.05,
      };
    }

    // 2. The conversation is over from the other side.
    if (kernel.signals.some((s) => s.type === "surface-terminated")) {
      return {
        action: {
          kind: "abandon",
          reason: "The conversation ended before I got what I needed.",
        },
        rationale: "It's gone. There's nothing left to talk to.",
        prediction: {
          description: "I stop.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    // 3. The breaking point. In a dialogue this arrives with a particular
    //    flavour — not "this is broken" but "it isn't listening to me".
    if (emotion.frustration >= abandonmentThreshold(persona)) {
      return {
        action: {
          kind: "abandon",
          reason: `Gave up after ${kernel.repairAttempts} attempt(s) to be understood while trying to ${goals.root.description}.`,
        },
        rationale: "I've said this every way I know how. It isn't listening.",
        prediction: {
          description: "I stop talking to it.",
          expectedSignals: [],
          expectsChange: false,
          confidence: 1,
        },
        effort: 0,
      };
    }

    const misunderstood = kernel.signals.find(
      (s): s is Extract<SurfaceSignal, { type: "not-understood" }> => s.type === "not-understood",
    );
    const handoff = kernel.affordances.find((a) => a.kind === "chat.handoff");
    // Willingness to try again, spent down by every attempt already made.
    const persistence = clamp01(
      (persona.traits.patience * 0.5 + persona.traits.resilience * 0.5) *
        (1 - kernel.repairAttempts * 0.3),
    );

    // 4/5. It did not understand. Rephrase, or stop rephrasing.
    if (misunderstood) {
      // Nobody walks away from the first miss without trying once — being
      // misunderstood one time reads as bad luck, not as a broken surface.
      // The give-up branch only opens once a repair has already failed.
      const mayGiveUp = kernel.repairAttempts >= 1;
      // The hard cap matches the three phrasings `rephrase` knows how to
      // produce. Capping at 2 made the last of them — stripping the sentence
      // down to keywords, which is what people actually resort to — dead
      // code that no run could ever reach.
      if (mayGiveUp && (kernel.repairAttempts >= 3 || rng.next() > persistence)) {
        if (handoff) {
          return {
            action: { kind: "invoke", verb: "chat.escalate", target: null },
            rationale: "This isn't working. Let me talk to a person.",
            prediction: {
              description: "It should hand me over to someone.",
              expectedSignals: ["human", "agent", "person"],
              expectsChange: true,
              confidence: 0.6,
            },
            effort: 0.2,
          };
        }
        return {
          action: {
            kind: "abandon",
            reason: `It never understood "${goals.root.description}", and there is no way to reach a person.`,
          },
          rationale: "It doesn't understand me and there's no way through to anyone who would.",
          prediction: {
            description: "I give up on this channel.",
            expectedSignals: [],
            expectsChange: false,
            confidence: 1,
          },
          effort: 0,
        };
      }

      return {
        action: {
          kind: "invoke",
          verb: "chat.rephrase",
          target: null,
          payload: rephrase(goals.root.description, kernel.repairAttempts),
        },
        rationale: misunderstood.confident
          ? "That answered something I didn't ask. Let me try putting it another way."
          : "It didn't get that. Let me say it differently.",
        prediction: {
          description: "Maybe it understands this phrasing.",
          expectedSignals: [],
          expectsChange: true,
          confidence: clamp01(0.5 - kernel.repairAttempts * 0.15),
        },
        effort: clamp01(0.3 + kernel.repairAttempts * 0.2),
      };
    }

    // 6. It declined, but named a way out. People take the exit when offered.
    const refused = kernel.signals.some((s) => s.type === "error");
    if (refused && handoff) {
      return {
        action: { kind: "invoke", verb: "chat.escalate", target: null },
        rationale: "It can't help with this, but it offered a person — I'll take that.",
        prediction: {
          description: "Someone who can help should pick this up.",
          expectedSignals: ["human", "agent", "person"],
          expectsChange: true,
          confidence: 0.65,
        },
        effort: 0.15,
      };
    }

    // 7. Nothing said yet: open with what I actually came for. The transcript
    //    itself records whether we have spoken, so nothing needs holding in
    //    working memory to remember it.
    const hasSpoken = kernel.turns.some((turn) => turn.speaker === "operator");
    if (!hasSpoken) {
      return {
        action: {
          kind: "invoke",
          verb: "chat.say",
          target: null,
          payload: goals.root.description,
        },
        rationale: `Asking about what I came for: ${goals.root.description}.`,
        prediction: {
          description: "It should answer, or ask me something back.",
          expectedSignals: [],
          expectsChange: true,
          confidence: this.baseConfidence(ctx),
        },
        effort: 0.2,
      };
    }

    // 8. It answered something. Follow up on the part that is still missing.
    const followUpKey = `followup:${kernel.turns.length}`;
    if (!memory.currentThoughts().some((t) => t.content === followUpKey)) {
      memory.hold(followUpKey, ctx.step);
      const suggestion = kernel.affordances.find((a) => a.kind === "chat.suggestion");
      if (suggestion && rng.next() < persona.traits.keyboardPreference + 0.35) {
        // A chip is the cheapest possible turn, and people take cheap turns.
        return {
          action: {
            kind: "invoke",
            verb: "chat.followup",
            target: null,
            payload: suggestion.description,
          },
          rationale: `It offered "${suggestion.description}" — that's easier than typing.`,
          prediction: {
            description: "It should follow its own suggestion somewhere useful.",
            expectedSignals: [],
            expectsChange: true,
            confidence: 0.7,
          },
          effort: 0.1,
        };
      }
      return {
        action: {
          kind: "invoke",
          verb: "chat.followup",
          target: null,
          payload: followUp(goals.root.description, kernel.turns.length),
        },
        rationale: "That didn't quite cover it — following up.",
        prediction: {
          description: "The follow-up should fill in what's missing.",
          expectedSignals: [],
          expectsChange: true,
          confidence: 0.55,
        },
        effort: 0.25,
      };
    }

    // Nothing left to ask, and it never got there.
    return {
      action: {
        kind: "abandon",
        reason: `The conversation stopped being useful before "${goals.root.description}" was resolved.`,
      },
      rationale: "We're going in circles. I'll find another way.",
      prediction: {
        description: "I stop talking to it.",
        expectedSignals: [],
        expectsChange: false,
        confidence: 1,
      },
      effort: 0,
    };
  }

  private handleDialog(ctx: CognitiveContext): Decision | null {
    const { percept, persona } = ctx;
    if (percept.dialogs.length === 0) return null;
    const dialog = percept.dialogs[0]!;

    // Look for a control inside the dialog to dismiss/accept it.
    const dialogBox = dialog.box;
    const inDialog = percept.elements.filter(
      (el) =>
        el.interactive &&
        !el.disabled &&
        (!dialogBox ||
          (el.box.x >= dialogBox.x - 4 &&
            el.box.y >= dialogBox.y - 4 &&
            el.box.x + el.box.width <= dialogBox.x + dialogBox.width + 4 &&
            el.box.y + el.box.height <= dialogBox.y + dialogBox.height + 4)),
    );
    const affirmative = inDialog.find((el) =>
      /\b(ok|okay|accept|agree|got it|continue|close|dismiss|allow|yes)\b/i.test(el.text),
    );
    const target = affirmative ?? inDialog[0] ?? null;
    if (!target) return null;

    const cautious = persona.traits.riskTolerance < 0.3;
    return {
      action: { kind: "click", target },
      rationale: cautious
        ? `A dialog appeared ("${dialog.text.slice(0, 60)}…"). Reading it carefully, then choosing "${target.text.trim()}".`
        : `A dialog is in the way — clicking "${target.text.trim()}" to move on.`,
      prediction: {
        description: "The dialog should close and return me to the page.",
        expectedSignals: [],
        expectsChange: true,
        confidence: 0.8,
      },
      effort: 0.25,
    };
  }

  private handleFormSubmit(ctx: CognitiveContext): Decision | null {
    const { percept, memory } = ctx;
    const sig = screenSignature(percept);
    const node = memory.knownScreens().find((s) => s.signature === sig);
    if (!node) return null;
    // Only fires when this screen has fields the operator already filled.
    const filledFields = [...node.triedAffordances].filter((a) => a.startsWith("field:"));
    if (filledFields.length === 0) return null;
    const remainingFields = percept.elements.filter(
      (el) => el.editable && !el.disabled && !node.triedAffordances.has(fieldKey(el)),
    );
    if (remainingFields.length > 0) return null;

    const submitRe =
      /\b(submit|send|save|log ?in|sign ?(in|up)|create|continue|next|reset|search|apply|confirm|done|finish|register|update|go)\b/i;
    const buttons = percept.elements.filter(
      (el) => el.role === "button" && el.interactive && !el.disabled && el.text.trim(),
    );
    const untried = buttons.filter(
      (el) => !node.triedAffordances.has(el.text.trim().toLowerCase()),
    );
    const submit =
      untried.find((el) => submitRe.test(el.text)) ??
      (untried.length === 1 ? untried[0] : undefined);
    if (!submit) return null;
    memory.markTried(sig, submit.text);
    return {
      action: { kind: "click", target: submit },
      rationale: `The form is filled in — "${submit.text.trim()}" should submit it.`,
      prediction: predictInteraction(submit, "click", this.baseConfidence(ctx)),
      effort: 0.2,
    };
  }

  private handleFormField(ctx: CognitiveContext, goalKeywords: readonly string[]): Decision | null {
    const { percept, persona, memory } = ctx;
    const sig = screenSignature(percept);
    const node = memory.knownScreens().find((s) => s.signature === sig);

    const emptyFields = percept.elements.filter(
      (el) =>
        el.editable &&
        !el.disabled &&
        el.box.width > 4 &&
        !(node?.triedAffordances.has(fieldKey(el)) ?? false),
    );
    if (emptyFields.length === 0) return null;

    // Only volunteer to fill fields when a form seems goal-relevant, or the
    // screen is clearly form-centric (few other affordances).
    const buttons = percept.elements.filter((e) => e.role === "button" && e.interactive);
    const formCentric = emptyFields.length >= 1 && buttons.length <= 4;
    const relevant =
      goalKeywords.some((kw) => emptyFields.some((f) => tokenize(f.text).includes(kw))) ||
      /\b(login|log in|sign|search|register|form|create|checkout|submit)\b/i.test(
        `${goalKeywords.join(" ")} ${percept.title}`,
      );
    if (!formCentric && !relevant) return null;

    const field = emptyFields[0]!;
    memory.markTried(sig, fieldKey(field));
    const text = plausibleInput(field, persona.name);
    return {
      action: { kind: "type", target: field, text },
      rationale: `This form wants "${field.text.trim() || "some input"}" — filling it in.`,
      prediction: predictInteraction(field, "type", this.baseConfidence(ctx)),
      effort: 0.3,
    };
  }
}

function fieldKey(el: VisibleElement): string {
  // Keyed by position, not label: a field's visible text changes once it is
  // filled (its value becomes the label), which would otherwise make the
  // operator type into the same field forever.
  return `field:${Math.round(el.box.x)},${Math.round(el.box.y)}`;
}

/** The tool name behind an `mcp.tool` kernel affordance id (`tool:<name>`). */
function toolNameOf(affordance: { id: string; description: string }): string {
  return affordance.id.startsWith("tool:") ? affordance.id.slice(5) : affordance.id;
}

/** Signals that mean "the last call failed" on a tool surface. */
function isFailureSignal(
  signal: SurfaceSignal,
): signal is Extract<SurfaceSignal, { type: "error" | "tool-result" }> {
  return signal.type === "error" || (signal.type === "tool-result" && signal.isError);
}

/**
 * Generate the input a human would plausibly type, inferred purely from the
 * field's visible label/placeholder text.
 */
export function plausibleInput(field: VisibleElement, personaName: string): string {
  const label = field.text.toLowerCase();
  if (/e-?mail/.test(label)) return `${personaName.replace(/[^a-z0-9]/g, ".")}@example.com`;
  if (/password/.test(label)) return "CorrectHorse!42";
  if (/phone|tel/.test(label)) return "555-0142";
  if (/search|find|query/.test(label)) return "settings";
  if (/first\s*name/.test(label)) return "Alex";
  if (/last\s*name|surname/.test(label)) return "Rivera";
  if (/\bname\b|user/.test(label)) return "Alex Rivera";
  if (/company|organization/.test(label)) return "Acme Corp";
  if (/city/.test(label)) return "Springfield";
  if (/zip|postal/.test(label)) return "62704";
  if (/address/.test(label)) return "742 Evergreen Terrace";
  if (/date|dob|birth/.test(label)) return "1990-04-12";
  if (/url|website|link/.test(label)) return "https://example.com";
  if (/title|subject/.test(label)) return "A quick test";
  if (/comment|message|description|note/.test(label)) {
    return "Just trying this out to see how it works.";
  }
  if (/amount|price|number|quantity|qty/.test(label)) return "3";
  return "test input";
}

export type { Action };

/** Blocks a reader stops *on* — the things worth working out, not reading past. */
const STUDYABLE: ReadonlySet<string> = new Set(["doc.table", "doc.figure", "doc.metric"]);

/** Shorten an affordance description for first-person rationale text. */
function truncateLabel(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Say the same thing a different way.
 *
 * People do not rewrite from scratch when a bot misses them — they simplify,
 * then they shout. The progression here is the one anyone can recognize
 * from their own last argument with a support bot: add words to explain,
 * then strip words down to the keyword, in the hope that plainer input is
 * what it wanted.
 */
function rephrase(goal: string, attempt: number): string {
  const core = goal.replace(/^(?:i want to|i need to|try to|please)\s+/i, "").trim();
  switch (attempt) {
    case 0:
      return `Sorry — what I mean is: ${core}`;
    case 1:
      // "I need to <core>" rather than "I need help with <core>": goals are
      // phrased as verbs ("get a refund"), and the latter reads as broken
      // English in the transcript the report prints.
      return `Let me put it another way — I need to ${core}.`;
    default:
      // The last resort: keywords, no sentence. This is what people type
      // when they have given up on being understood as a person.
      return core
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 4)
        .join(" ");
  }
}

/** Ask for the part the answer left out. */
function followUp(goal: string, turns: number): string {
  const core = goal.replace(/^(?:i want to|i need to|try to|please)\s+/i, "").trim();
  return turns > 4
    ? `That still doesn't answer it — how do I actually ${core}?`
    : `Thanks — and how do I ${core}?`;
}
