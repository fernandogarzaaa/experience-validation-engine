# The Cognitive Model (Phase 2)

Phase 2 deepens EVE from a persona-driven heuristic agent into a research
platform for autonomous human-experience simulation. Every addition makes the
simulated operator's cognition more faithful to a real human's, and every one
is grounded in published work (see [research.md](./research.md)) and
independently testable.

Everything here is **opt-in and backwards-compatible**: with none of these
options set, `EveSession` behaves exactly as in phase 1.

## Enabling the enhanced cognition

```ts
import { EveSession, UtilityCognition, FileMemoryStore } from "experience-validation-engine";

new EveSession({
  adapter, startUrl,
  persona: "first-time-user",
  policy: new UtilityCognition(),            // utility-based decisions
  cognitive: true,                            // attention + trust + load + expectation
  longTermMemory: new FileMemoryStore(".eve-memory.json"), // cross-session memory
  culture: "de-DE",                           // cultural profile
});
```

CLI: `--cognitive --utility --culture de-DE --profession accountant --remember .eve-memory.json`.

## 1. Selective attention (`cognition/attention.ts`)

Humans don't perceive everything on a screen. Each glance is modeled as a
sequence of **fixations** allocated by the SEEV model (Salience + Effort +
Expectancy + Value; Wickens 2003): visual salience (size, contrast, warning
color, role), an F-pattern scanning prior (mirrored under RTL cultures),
recency of change, and goal relevance. Only **attended** elements enter the
decision. Consequences:

- **Inattentional blindness**: strong goal focus narrows attention and
  suppresses peripheral capture (Simons & Chabris 1999).
- **Change blindness**: changes to unattended elements are not perceived and
  are logged as `missedChanges` (Rensink et al. 1997).
- Fixations, saccade distances and glance time are recorded for the
  interaction heatmap and reports.

## 2. Utility-based decisions (`cognition/utility.ts`, `UtilityCognition`)

The phase-1 salience-softmax choice is replaced (opt-in) by explicit
expected-utility evaluation over candidate actions:

```
utility = w_success·P(success) + w_reward·reward + w_curiosity·novelty
        − w_risk·risk − w_effort·effort − w_time·time
```

Selection is **softmax** (Luce choice), never argmax — human choice is
stochastic. Crucially, the weights are **modulated by the emotional state**,
closing the emotion → decision loop:

| State | Effect on decisions |
|---|---|
| High frustration | curiosity collapses, urgency & reward-seeking rise → beeline or bail |
| High confidence | experimentation rises, risk aversion falls |
| Low trust | risk aversion rises; verification behavior appears |
| High fatigue | effort/time aversion rises → least-effort choices |

Risk is weighted asymmetrically vs reward (loss aversion; Kahneman & Tversky
1979). Motor effort uses a Fitts-law distance/size cost. Decision temperature
shrinks under urgency (attentional narrowing).

## 3. The expectation engine (`cognition/expectation.ts`)

Before every interaction the operator commits to a **full** expectation, not
just an outcome string: what should happen, what should appear, how long it
should take, where they should arrive, what visual change should occur, what
feedback should appear (predictive processing; Clark 2013). Afterwards each
dimension is scored:

- **Expectation Match Score** (0..1), **Surprise** (1 − match), and a
  per-violation **severity**.
- Repeated violations compound frustration and reduce trust (a
  `ViolationStreak`), matching how learned unpredictability erodes confidence
  faster than isolated slips (expectation disconfirmation; Oliver 1980).

## 4. Cognitive load (`cognition/cognitiveLoad.ts`)

A **Cognitive Load Index** (0..100) estimates the *extraneous* load the
interface imposes (Cognitive Load Theory; Sweller 1988), decomposed
NASA-TLX-style into working-memory load (Hick–Hyman choice complexity vs the
persona's WM capacity), information load, decision load, visual clutter
(Rosenholtz 2007), and task-switch load. `DecisionFatigue` accumulates across
choices (ego depletion) and feeds bodily fatigue.

## 5. The trust model (`emotion/trust.ts`)

Trust builds slowly and falls quickly (asymmetry; Slovic 1993), decomposed
into predictability, consistency, error recovery, feedback quality and
security perception (Lee & See 2004). It updates from outcomes (surprise,
errors, dead clicks, latency), from revisiting consistent screens, and from
perceived security cues in the URL/copy. When active, the trust model **owns**
the operator's `trust` emotion, which in turn drives verification behavior in
the utility policy.

## 6. Long-term memory & learning (`memory/longTerm.ts`, `memory/learning.ts`)

A persistent, per-application memory store (`FileMemoryStore` /
`InMemoryStore`) lets the operator **remember an app between sessions**:
screens, button locations, learned facts/shortcuts, favorite (completed)
workflows, frustration spots, and a per-session history. Between sessions,
memory decays on an **Ebbinghaus forgetting curve** with reinforcement
(retention-trait-dependent). A returning operator:

- **recognizes** familiar screens (skips re-reading — recognition over recall,
  Nielsen heuristic #6),
- **recalls** previously-successful paths (a `recall()` signal boosts their
  utility),
- starts with **familiarity-driven confidence**.

`computeLearningMetrics` derives, across sessions: **Learning Rate** (the
power-law-of-practice exponent α; Newell & Rosenbloom 1981), **Retention**,
**Memory Recall**, **Recognition-vs-Recall** ratio, a **Forgetting Curve**,
and per-session efficiency series — with an inline SVG learning curve for
reports. In practice a returning operator completes the same task in fewer
steps each session (e.g. 7 → 5 → 5).

## 7. Emotional evolution

Phase-1 appraisal is extended so **current emotion shapes future decisions**
(via the utility weights above) and violation streaks compound. The result is
realistic spirals and recoveries: a frustrated operator stops exploring and
either rushes or quits; a confident one experiments; a distrustful one
double-checks.

## Social & cultural personas

- **Professions** (`personas/professions.ts`): doctor, teacher, lawyer,
  designer, accountant, student, salesperson, executive. A profession is an
  *overlay* — domain vocabulary, workflow priorities, habits and trait deltas
  layered onto any base persona (`applyProfession`).
- **Cultures** (`personas/culture.ts`): reading direction, date/number/
  currency formats, privacy expectations, name order, language hints. The
  culture drives attention scanning direction and powers the localization
  plugin's convention-mismatch findings.

## Where the systems connect

```
                 ┌───────────── attention ─────────────┐
 percept ───────▶│ fixations → attended elements only  │──▶ decision policy
                 └─────────────────────────────────────┘        │ (utility,
   │                                                              │  weights from
   │  cognitive load ──┐                                          │  emotion+trust,
   ▼                   ▼                                          │  recall from LTM)
 trust model ◀─ outcome ◀─ expectation scoring ◀────────── act ◀─┘
   │  │                │
   ▼  ▼                ▼
 emotion (trust, frustration, confidence, fatigue) ──▶ next decision's weights
   │
   ▼
 long-term memory (persisted) ──▶ next session starts more expert
```

Every arrow is inspectable: fixations, load samples, trust timeline,
expectation scores, and the learning curve all ship in `SessionResult` and the
reports.
