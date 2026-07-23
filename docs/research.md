# Research Foundations

Every EVE subsystem is grounded in published work from HCI, cognitive
psychology, human factors and behavioral economics. This page records the
theory behind each architectural decision, so contributors can evaluate
model changes against the literature rather than against taste.

## Positioning

Recent systems simulate users by prompting an LLM to role-play a persona:
UXAgent (Lu et al., CHI 2025) generates thousands of LLM-simulated shoppers;
PerceptUI aligns LLM agents with human UI perception; UXBench measures the
actionability of LLM UX critiques. These validate the *demand* for simulated
users but inherit the LLM's opacity: you cannot inspect *why* the simulated
user struggled, and runs are not reproducible.

EVE takes the complementary, mechanistic path: cognition is built from
explicit, parameterized models with per-step inspectable state (and an
optional LLM policy where open-ended reasoning helps). Reproducibility,
interpretability and controlled ablation are first-class — which is what a
*research platform* needs.

## Per-system grounding

### Attention (`src/cognition/attention.ts`)

- **Saliency**: feature-based visual saliency (Itti & Koch 2000) — size,
  contrast, color; extended with *semantic* saliency (goal relevance), per
  guided search theory (Wolfe 1994).
- **SEEV model** (Wickens et al. 2003): attention allocation =
  Salience + Effort + Expectancy + Value. EVE's fixation scoring mirrors
  this: visual salience + scan-path effort + expectation (prior screen
  knowledge) + goal value.
- **Scanning**: F-pattern reading of interfaces (Nielsen 2006); top-left
  bias for LTR readers, mirrored under RTL (cultural profile).
- **Fixations & saccades**: ~200–400 ms fixations, ballistic saccades
  (Rayner 1998). EVE approximates a fixation sequence, not a full oculomotor
  model.
- **Change blindness** (Rensink, O'Regan & Clark 1997) and **inattentional
  blindness** (Simons & Chabris 1999): unattended changes are not perceived.
  EVE only admits attended elements into decision-making, and logs unnoticed
  changes as missed-change events.

### Decision-making (`src/cognition/utility.ts`)

- **Utility-based choice** with softmax action selection (Luce 1959; Sutton
  & Barto 2018): candidates are scored on expected success, reward,
  curiosity, risk, effort, time and urgency; selection is probabilistic with
  a temperature, never argmax — matching human choice stochasticity.
- **Prospect theory** (Kahneman & Tversky 1979): losses loom larger than
  gains — risk (destructive actions) is weighted asymmetrically, modulated
  by emotional state.
- **Fitts' law** (Fitts 1954) for motor effort: effort grows with distance
  and shrinks with target size.
- **Hick–Hyman law** (Hick 1952): decision time and load grow with
  log2(choices), feeding cognitive load and decision fatigue.
- **Information foraging** (Pirolli & Card 1999): label "scent" (semantic
  match to the goal) is the primary driver of navigation choices.
- **Affect-as-information** (Schwarz & Clore 1983) and mood effects on
  exploration (Fredrickson 2001): frustration narrows attention and lowers
  exploration; confidence broadens it; low trust induces verification
  behavior. Implemented as emotion-dependent utility weights.

### Expectation engine (`src/cognition/mentalModel.ts`)

- **Predictive processing** (Clark 2013): perception is prediction +
  error correction. Every action carries a full expectation (outcome,
  destination, latency, feedback); surprise = prediction error.
- **Doherty threshold** (~400 ms) and response-time research (Nielsen
  1993): expected latencies scale with perceived action weight; overruns are
  violations.
- **Expectation disconfirmation** (Oliver 1980): satisfaction is driven by
  expectation vs. outcome, not outcome alone — violations damage trust and
  satisfaction beyond the objective failure.

### Memory (`src/memory/`)

- **Working memory capacity** ≈ 4 ± 1 chunks (Cowan 2001; after Miller
  1956).
- **Forgetting curve** (Ebbinghaus 1885): exponential decay with
  reinforcement; cross-session decay uses e^(−λ·Δ) on fact strength.
- **Negativity bias** (Baumeister et al. 2001): errors are retained longer.
- **Recognition vs recall** (Mandler 1980; Nielsen's usability heuristic
  #6): recognizing a previously-seen screen is easier than recalling how to
  reach it; EVE measures both separately across sessions.
- **Power law of practice** (Newell & Rosenbloom 1981): task time follows
  T(n) = T(1)·n^(−α) across sessions; EVE fits α as the measured Learning
  Rate.
- **Spacing/decay across sessions** (Anderson & Schooler 1991, the ACT-R
  rational analysis of memory): availability of a memory trace reflects its
  past use — EVE's long-term store decays by sessions elapsed and
  reinforces on reuse.

### Cognitive load (`src/cognition/cognitiveLoad.ts`)

- **Cognitive load theory** (Sweller 1988): intrinsic (task), extraneous
  (interface) and germane load; EVE's index isolates *extraneous* load —
  the part the interface owns.
- **NASA-TLX** (Hart & Staveland 1988): multi-component workload
  assessment inspires the decomposition (working-memory use, information
  load, decision load, clutter, task switching).
- **Visual clutter** (Rosenholtz et al. 2007): density + disorganization
  as measurable clutter.

### Trust (`src/emotion/trust.ts`)

- **Trust in automation** (Lee & See 2004; Muir 1987): trust builds from
  predictability, dependability and faith; is damaged by violations; and
  recovers slowly and asymmetrically (Slovic 1993 — trust is easier to
  destroy than to build). EVE models component trust (predictability,
  consistency, error recovery, feedback quality, security perception) with
  asymmetric update rates.
- **Perceived security** cues (Fogg 2003, credibility): visible protocol,
  data requests, and consistency feed security perception.

### Emotion (`src/emotion/`)

- **Appraisal theory** (Lazarus 1991; Scherer 2001): emotion arises from
  goal-relevance appraisals of events — implemented in phase 1 and extended
  in phase 2 with violation streaks (repeated disconfirmation compounds).
- **Broaden-and-build** (Fredrickson 2001) for positive-affect
  exploration; **attentional narrowing** under stress (Easterbrook 1959).

### Behavioral & temporal regression (`src/regression/`)

- **Usability metrics** (Sauro & Lewis 2012, *Quantifying the User
  Experience*): completion, time-on-task, errors as core metrics; EVE adds
  cognitive metrics (confidence, load, hesitation) and compares across
  builds — regressions functional tests cannot see.

### Journey discovery (`src/workflow/journeys.ts`)

- **Mental model elicitation / task analysis** (Card, Moran & Newell 1983,
  GOMS): journeys are recovered from behavior, not scripts; EVE extracts
  the achieved operator sequence as the discovered journey.

### Multi-agent panel (`src/panel/`)

- **Evaluator effect** (Hertzum & Jacobsen 2001): different evaluators find
  different problems; consensus across evaluators is the strongest signal.
  The Moderator formalizes consensus/disagreement across personas.
- **Heuristic evaluation** (Nielsen & Molich 1990; Nielsen 1994): the
  Design Critic implements the classic 10 heuristics plus typography/layout
  heuristics, independent of the behavioral simulation — mirroring how
  expert review complements user testing (dual-method evaluation).

### Benchmarks (`src/benchmarks/`)

- **Construct validity**: a measurement instrument must discriminate known
  cases. The benchmark suite (bad / average / excellent UX apps) is EVE's
  standing validity check — score ordering must hold, enforced by tests.

## Sources

- Lu et al., *UXAgent: An LLM Agent-Based Usability Testing Framework for
  Web Design*, CHI EA 2025 — https://arxiv.org/abs/2502.12561
- *PerceptUI: LLM Agents as Human-Aligned Synthetic Users for UI/UX
  Evaluation* — https://arxiv.org/pdf/2606.05697
- *UXBench: Measuring the Actionability of LLM-Generated UX Critiques* —
  https://arxiv.org/pdf/2606.16262
- *User Behavior Simulation with LLM-based Agents*, ACM TOIS —
  https://dl.acm.org/doi/abs/10.1145/3708985

Classic references cited above are standard texts; see each subsystem's
module documentation for the parameter-level mapping.
