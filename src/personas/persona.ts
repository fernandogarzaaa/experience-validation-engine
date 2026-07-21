/**
 * Persona model.
 *
 * A persona is a bundle of behavioral parameters that modulate every part of
 * the simulation: how fast the operator reads, how accurately they click, how
 * long they tolerate friction, how willing they are to experiment, how much
 * they remember. Traits are dimensionless 0..1 values unless noted otherwise;
 * downstream modules translate them into concrete quantities (milliseconds,
 * pixels, probabilities).
 */

export interface PersonaTraits {
  /** Words per minute of comfortable reading (absolute, not 0..1). */
  readingSpeedWpm: number;
  /** Motor precision: 1 = pixel-perfect clicks, 0 = frequent slips. */
  clickAccuracy: number;
  /** Overall movement/typing tempo: 1 = very fast, 0 = very slow. */
  motorSpeed: number;
  /** How well screens/labels are retained across steps. */
  memoryRetention: number;
  /** Willingness to click destructive-looking or unfamiliar controls. */
  riskTolerance: number;
  /** Tolerance for friction before frustration snowballs. */
  patience: number;
  /** Ability to stay on the current subgoal without wandering. */
  attentionSpan: number;
  /** Drive to explore unvisited areas of the product. */
  curiosity: number;
  /** Baseline self-confidence when facing an unfamiliar screen. */
  baseConfidence: number;
  /** Willingness to try actions with unknown outcomes. */
  experimentation: number;
  /** Preference for keyboard (shortcuts, tab) over mouse. */
  keyboardPreference: number;
  /** Prior exposure to software conventions ("a gear icon means settings"). */
  techLiteracy: number;
  /** How quickly experience updates the mental model. */
  learningRate: number;
  /** Probability per step of a momentary distraction/idle pause. */
  distractibility: number;
  /** Ability to recover composure after an error. */
  resilience: number;
  /** Tendency to read everything vs skim. */
  thoroughness: number;
}

export interface AccessibilityProfile {
  /** Simulated color vision deficiency, affects contrast findings weighting. */
  colorVision: "typical" | "protanopia" | "deuteranopia" | "tritanopia";
  /** Minimum comfortable font size in px; smaller text raises effort. */
  minComfortableFontPx: number;
  /** Operator relies primarily on the keyboard (no mouse). */
  keyboardOnly: boolean;
  /** Multiplier on all motor action durations (tremor, limited dexterity). */
  motorDifficultyFactor: number;
}

export interface Persona {
  readonly name: string;
  readonly description: string;
  readonly traits: PersonaTraits;
  readonly accessibility: AccessibilityProfile;
  /** Initial emotional disposition overrides (0..1 per emotion). */
  readonly disposition: Partial<Record<string, number>>;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityProfile = {
  colorVision: "typical",
  minComfortableFontPx: 11,
  keyboardOnly: false,
  motorDifficultyFactor: 1,
};

const TRAIT_KEYS: readonly (keyof PersonaTraits)[] = [
  "readingSpeedWpm",
  "clickAccuracy",
  "motorSpeed",
  "memoryRetention",
  "riskTolerance",
  "patience",
  "attentionSpan",
  "curiosity",
  "baseConfidence",
  "experimentation",
  "keyboardPreference",
  "techLiteracy",
  "learningRate",
  "distractibility",
  "resilience",
  "thoroughness",
];

/** Average adult reading speed baseline. */
export const BASELINE_TRAITS: PersonaTraits = {
  readingSpeedWpm: 240,
  clickAccuracy: 0.85,
  motorSpeed: 0.6,
  memoryRetention: 0.65,
  riskTolerance: 0.45,
  patience: 0.55,
  attentionSpan: 0.6,
  curiosity: 0.5,
  baseConfidence: 0.55,
  experimentation: 0.45,
  keyboardPreference: 0.3,
  techLiteracy: 0.55,
  learningRate: 0.55,
  distractibility: 0.2,
  resilience: 0.55,
  thoroughness: 0.5,
};

export interface PersonaSpec {
  name: string;
  description?: string;
  traits?: Partial<PersonaTraits>;
  accessibility?: Partial<AccessibilityProfile>;
  disposition?: Partial<Record<string, number>>;
}

/** Build a complete persona from a partial spec, validating trait ranges. */
export function definePersona(spec: PersonaSpec): Persona {
  const traits: PersonaTraits = { ...BASELINE_TRAITS, ...spec.traits };
  for (const key of TRAIT_KEYS) {
    const value = traits[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Persona "${spec.name}": trait ${key} must be a number`);
    }
    if (key === "readingSpeedWpm") {
      if (value < 40 || value > 1200) {
        throw new Error(
          `Persona "${spec.name}": readingSpeedWpm ${value} out of range 40..1200`,
        );
      }
    } else if (value < 0 || value > 1) {
      throw new Error(`Persona "${spec.name}": trait ${key}=${value} out of range 0..1`);
    }
  }
  return {
    name: spec.name,
    description: spec.description ?? "",
    traits,
    accessibility: { ...DEFAULT_ACCESSIBILITY, ...spec.accessibility },
    disposition: spec.disposition ?? {},
  };
}

/* ------------------------------------------------------------------ */
/* Trait → concrete behavior translation                              */
/* ------------------------------------------------------------------ */

/** Time to read `wordCount` words, in ms. Thoroughness gates skimming. */
export function readingTimeMs(persona: Persona, wordCount: number): number {
  const effectiveWords =
    wordCount * (0.35 + 0.65 * persona.traits.thoroughness); // skimmers read a subset
  const msPerWord = 60_000 / persona.traits.readingSpeedWpm;
  return Math.max(120, effectiveWords * msPerWord);
}

/** Base pointer travel + settle time for one motor action, in ms. */
export function motorActionMs(persona: Persona): number {
  const base = 1400 - persona.traits.motorSpeed * 1000; // 400..1400ms
  return base * persona.accessibility.motorDifficultyFactor;
}

/** Per-character typing interval in ms. */
export function typingIntervalMs(persona: Persona): number {
  // ~40wpm (300ms/char) for slow typists up to ~110wpm (~110ms/char).
  const interval = 300 - persona.traits.motorSpeed * 190;
  return interval * persona.accessibility.motorDifficultyFactor;
}

/**
 * Standard deviation, in px, of click landing position around the intended
 * target center. Small targets plus low accuracy produce misclicks.
 */
export function clickScatterPx(persona: Persona): number {
  return (
    (1 - persona.traits.clickAccuracy) * 14 * persona.accessibility.motorDifficultyFactor
  );
}

/**
 * How many recent items fit in working memory. Humans hold roughly 4±1
 * chunks; retention shifts within that envelope.
 */
export function workingMemoryCapacity(persona: Persona): number {
  return Math.round(3 + persona.traits.memoryRetention * 3); // 3..6
}

/** Frustration level (0..1) at which the operator abandons the task. */
export function abandonmentThreshold(persona: Persona): number {
  return 0.55 + persona.traits.patience * 0.4; // 0.55..0.95
}
