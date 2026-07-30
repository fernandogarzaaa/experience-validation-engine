import { type Persona, definePersona } from "./persona.js";

/**
 * Built-in persona library.
 *
 * Each persona is a coherent behavioral profile, not just a label: the trait
 * values are chosen so that the resulting simulated behavior matches the
 * archetype (a "power user" genuinely presses keyboard shortcuts and skims;
 * an "elderly user" genuinely reads slowly and clicks conservatively).
 */
const personas: Persona[] = [
  definePersona({
    name: "first-time-user",
    description:
      "Has never seen this product. Reads carefully, hesitates before clicking, builds a mental model from scratch.",
    traits: {
      techLiteracy: 0.45,
      baseConfidence: 0.35,
      curiosity: 0.6,
      experimentation: 0.35,
      riskTolerance: 0.3,
      thoroughness: 0.7,
      memoryRetention: 0.5,
      keyboardPreference: 0.1,
    },
    disposition: { curiosity: 0.7, confidence: 0.35 },
  }),
  definePersona({
    name: "power-user",
    description:
      "Expert with software conventions. Skims, moves fast, expects shortcuts, has little patience for friction.",
    traits: {
      readingSpeedWpm: 420,
      techLiteracy: 0.95,
      baseConfidence: 0.9,
      motorSpeed: 0.95,
      clickAccuracy: 0.95,
      keyboardPreference: 0.85,
      experimentation: 0.8,
      riskTolerance: 0.7,
      patience: 0.35,
      thoroughness: 0.25,
      memoryRetention: 0.9,
      learningRate: 0.9,
    },
    disposition: { confidence: 0.9, curiosity: 0.5 },
  }),
  definePersona({
    name: "office-worker",
    description:
      "Uses software daily as a means to an end. Moderately experienced, task-focused, mildly impatient.",
    traits: {
      techLiteracy: 0.6,
      baseConfidence: 0.6,
      patience: 0.5,
      thoroughness: 0.45,
      keyboardPreference: 0.4,
      curiosity: 0.3,
    },
  }),
  definePersona({
    name: "developer-as-customer",
    description:
      "A developer using the product as a paying customer. Technically fluent, judgmental about details, explores boundaries.",
    traits: {
      readingSpeedWpm: 380,
      techLiteracy: 0.98,
      baseConfidence: 0.85,
      experimentation: 0.9,
      curiosity: 0.8,
      keyboardPreference: 0.75,
      riskTolerance: 0.75,
      patience: 0.4,
      thoroughness: 0.35,
      memoryRetention: 0.85,
      learningRate: 0.9,
      motorSpeed: 0.85,
      clickAccuracy: 0.9,
    },
  }),
  definePersona({
    name: "project-manager",
    description:
      "Comfortable with SaaS tools, oriented toward overviews, statuses and exports. Reads selectively, delegates detail.",
    traits: {
      techLiteracy: 0.7,
      baseConfidence: 0.7,
      thoroughness: 0.4,
      patience: 0.55,
      curiosity: 0.45,
      keyboardPreference: 0.3,
      readingSpeedWpm: 300,
    },
  }),
  definePersona({
    name: "non-technical-user",
    description:
      "Low familiarity with software conventions. Takes labels literally, avoids anything that looks technical or risky.",
    traits: {
      techLiteracy: 0.15,
      baseConfidence: 0.3,
      riskTolerance: 0.15,
      experimentation: 0.2,
      keyboardPreference: 0.05,
      thoroughness: 0.75,
      readingSpeedWpm: 200,
      learningRate: 0.4,
      memoryRetention: 0.45,
    },
    disposition: { confidence: 0.3 },
  }),
  definePersona({
    name: "student",
    description:
      "Young, quick, curious, digitally native but domain-inexperienced. Learns fast, tolerates some friction.",
    traits: {
      readingSpeedWpm: 320,
      techLiteracy: 0.7,
      curiosity: 0.8,
      experimentation: 0.7,
      learningRate: 0.85,
      motorSpeed: 0.85,
      patience: 0.45,
      distractibility: 0.4,
      thoroughness: 0.35,
    },
  }),
  definePersona({
    name: "accessibility-user",
    description:
      "Keyboard-only operator. Navigates with Tab/Enter/arrows; unreachable or focus-trapping UI is a hard blocker.",
    traits: {
      keyboardPreference: 1,
      techLiteracy: 0.7,
      patience: 0.7,
      thoroughness: 0.7,
      baseConfidence: 0.6,
    },
    accessibility: { keyboardOnly: true, minComfortableFontPx: 13 },
  }),
  definePersona({
    name: "elderly-user",
    description:
      "Reads slowly and completely, clicks deliberately, distrusts unexpected changes, needs larger text and high contrast.",
    traits: {
      readingSpeedWpm: 140,
      motorSpeed: 0.2,
      clickAccuracy: 0.55,
      techLiteracy: 0.2,
      riskTolerance: 0.1,
      experimentation: 0.1,
      patience: 0.75,
      thoroughness: 0.9,
      memoryRetention: 0.4,
      learningRate: 0.3,
      keyboardPreference: 0.05,
    },
    accessibility: { minComfortableFontPx: 16, motorDifficultyFactor: 1.6 },
    disposition: { confidence: 0.35, trust: 0.4 },
  }),
  definePersona({
    name: "color-blind-user",
    description:
      "Deuteranopia. Cannot rely on red/green distinctions; color-only signals (status dots, error tints) are invisible.",
    traits: { techLiteracy: 0.6, thoroughness: 0.6 },
    accessibility: { colorVision: "deuteranopia" },
  }),
  definePersona({
    name: "impatient-user",
    description:
      "Wants results now. Skims aggressively, double-clicks slow buttons, abandons quickly when the product stalls.",
    traits: {
      patience: 0.1,
      thoroughness: 0.15,
      readingSpeedWpm: 360,
      motorSpeed: 0.9,
      riskTolerance: 0.6,
      distractibility: 0.3,
      resilience: 0.35,
    },
    disposition: { stress: 0.4 },
  }),
  definePersona({
    name: "distracted-user",
    description:
      "Multitasking; attention lapses constantly. Forgets what they were doing, re-reads screens, loses their place.",
    traits: {
      distractibility: 0.85,
      attentionSpan: 0.2,
      memoryRetention: 0.35,
      thoroughness: 0.3,
      patience: 0.5,
    },
  }),
  definePersona({
    name: "curious-explorer",
    description:
      "Opens every menu just to see what is inside. Coverage-oriented; friction is interesting rather than frustrating.",
    traits: {
      curiosity: 0.98,
      experimentation: 0.95,
      riskTolerance: 0.8,
      patience: 0.8,
      attentionSpan: 0.5,
      thoroughness: 0.55,
      techLiteracy: 0.65,
    },
    disposition: { curiosity: 0.95 },
  }),
  definePersona({
    name: "slow-reader",
    description:
      "Processes text slowly and completely; dense screens are exhausting. Dyslexia-informed reading profile.",
    traits: { readingSpeedWpm: 110, thoroughness: 0.85, patience: 0.65 },
    accessibility: { minComfortableFontPx: 14 },
  }),
  definePersona({
    name: "fast-reader",
    description: "Skims at very high speed; misses fine print and small labels.",
    traits: { readingSpeedWpm: 600, thoroughness: 0.2, motorSpeed: 0.8 },
  }),
  definePersona({
    name: "anxious-user",
    description:
      "Afraid of breaking something. Re-reads before every click, avoids destructive controls, errors hit hard.",
    traits: {
      riskTolerance: 0.05,
      baseConfidence: 0.25,
      experimentation: 0.1,
      thoroughness: 0.85,
      resilience: 0.25,
      patience: 0.6,
    },
    disposition: { stress: 0.5, confidence: 0.25, trust: 0.45 },
  }),
  definePersona({
    name: "confident-user",
    description:
      "Assumes the product works like others they know. Acts first, reads later; blames the product, not themselves.",
    traits: {
      baseConfidence: 0.95,
      riskTolerance: 0.8,
      experimentation: 0.75,
      thoroughness: 0.25,
      resilience: 0.85,
      techLiteracy: 0.75,
    },
    disposition: { confidence: 0.95 },
  }),
];

const registry = new Map<string, Persona>(personas.map((p) => [p.name, p]));

export function listPersonas(): readonly Persona[] {
  return personas;
}

export function getPersona(name: string): Persona {
  const persona = registry.get(name);
  if (!persona) {
    const known = [...registry.keys()].join(", ");
    throw new Error(`Unknown persona "${name}". Known personas: ${known}`);
  }
  return persona;
}

export function registerPersona(persona: Persona): void {
  registry.set(persona.name, persona);
  const idx = personas.findIndex((p) => p.name === persona.name);
  if (idx >= 0) personas[idx] = persona;
  else personas.push(persona);
}
