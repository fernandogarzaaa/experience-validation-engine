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
