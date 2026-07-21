# Persona Guide

A persona is not a label — it is a bundle of measurable behavioral
parameters that changes everything the simulated operator does: how fast
they read, where their clicks land, what they dare to press, what they
remember, and when they give up.

## Built-in personas

Run `eve personas` for the live list. Highlights:

| Persona | Behavioral essence |
|---|---|
| `first-time-user` | Reads carefully, hesitates, low conventions knowledge |
| `power-user` | 420wpm skimming, keyboard shortcuts, no patience for friction |
| `office-worker` | Task-focused daily driver, moderate everything |
| `developer-as-customer` | Expert, judgmental, probes boundaries |
| `project-manager` | Overview-oriented, reads selectively |
| `non-technical-user` | Takes labels literally, avoids anything technical |
| `student` | Fast, curious, digitally native, easily distracted |
| `accessibility-user` | Keyboard-only; unreachable UI is a hard blocker |
| `elderly-user` | 140wpm, deliberate clicks, ×1.6 motor time, high thoroughness |
| `color-blind-user` | Deuteranopia — red/green signals collapse |
| `impatient-user` | Abandons at the first sustained friction |
| `distracted-user` | Attention lapses, forgets working memory items |
| `curious-explorer` | Opens everything; maximal coverage |
| `slow-reader` / `fast-reader` | 110wpm complete reading / 600wpm skimming |
| `anxious-user` | Terrified of breaking things; errors hit hard |
| `confident-user` | Acts first, reads later, blames the product |

## The trait model

Sixteen traits (all 0..1 except `readingSpeedWpm`):

| Trait | Drives |
|---|---|
| `readingSpeedWpm` | Duration of `read` actions (40–1200 wpm) |
| `clickAccuracy` | Click scatter σ; misclicks on small targets |
| `motorSpeed` | Pointer travel time, typing cadence |
| `memoryRetention` | Working-memory capacity (3–6 chunks), episodic decay |
| `riskTolerance` | Hesitation/refusal on destructive controls |
| `patience` | Abandonment threshold, loading-wait tolerance |
| `attentionSpan` | How far down the salience list the eye wanders |
| `curiosity` | Weight of novelty in attention |
| `baseConfidence` | Starting confidence; prediction confidence |
| `experimentation` | Willingness to try unknown controls |
| `keyboardPreference` | Tab/Enter over mouse |
| `techLiteracy` | Conventions knowledge → prediction confidence |
| `learningRate` | Speed of semantic-memory updates |
| `distractibility` | Probability of losing a working-memory item per step |
| `resilience` | Emotional recovery after errors |
| `thoroughness` | Read-everything vs skim; fraction of text processed |

Plus an **accessibility profile**: `colorVision`
(typical/protanopia/deuteranopia/tritanopia), `minComfortableFontPx`,
`keyboardOnly`, `motorDifficultyFactor`.

And a **disposition**: starting overrides for any of the nine emotions
(e.g. an anxious persona starts with `stress: 0.5`).

## Defining a persona in code

```ts
import { definePersona } from "experience-validation-engine";

const persona = definePersona({
  name: "night-shift-nurse",
  description: "Expert but time-pressed and fatigued.",
  traits: {
    patience: 0.25,
    riskTolerance: 0.15,
    readingSpeedWpm: 260,
    distractibility: 0.5,
  },
  accessibility: { minComfortableFontPx: 12 },
  disposition: { fatigue: 0.5, stress: 0.45 },
});
```

Unspecified traits inherit the population baseline (`BASELINE_TRAITS`).
Ranges are validated eagerly — a typo like `patience: 7` throws immediately.

## Defining a persona in YAML

```yaml
customPersonas:
  - name: night-shift-nurse
    description: Expert but time-pressed and fatigued.
    traits:
      patience: 0.25
      riskTolerance: 0.15
    disposition:
      fatigue: 0.5
```

Then `persona: night-shift-nurse` in the same config.

## Designing good personas

1. **Start from a real user you have met.** Trait numbers should encode
   observations ("she reads every word of a dialog before clicking"), not
   stereotypes.
2. **Keep traits coherent.** High `experimentation` with zero
   `riskTolerance` produces a contradiction the simulation will express as
   erratic behavior. That may be intended (a stressed user!) — but choose it
   deliberately.
3. **Use the disposition for state, traits for disposition.** "Tired
   tonight" is `disposition.fatigue`; "always meticulous" is
   `traits.thoroughness`.
4. **Validate against the journal.** Read the session journal after a run —
   if the rationale lines don't sound like your user, adjust.
