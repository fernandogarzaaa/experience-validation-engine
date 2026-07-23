import type { Persona } from "./persona.js";
import { definePersona } from "./persona.js";

/**
 * Social personas: professional overlays.
 *
 * A profession is not a full persona — it is an overlay that layers domain
 * vocabulary, workflow priorities, expectations and habits onto a base
 * persona. This models how a doctor and an accountant, even with similar
 * baseline traits, bring different mental models and terminology to the same
 * software (domain expertise shapes perception; Chi, Feltovich & Glaser
 * 1981 on expert schemas).
 */

export interface Profession {
  readonly name: string;
  readonly description: string;
  /** Domain terms this professional recognizes and expects (boosts goal relevance / lowers load). */
  readonly vocabulary: readonly string[];
  /** Workflow kinds this professional prioritizes. */
  readonly workflowPriorities: readonly string[];
  /** Trait deltas applied to the base persona (added, then clamped). */
  readonly traitDeltas: Partial<Record<keyof Persona["traits"], number>>;
  /** Habit notes surfaced in reports (for realism/explanation). */
  readonly habits: readonly string[];
}

export const PROFESSIONS: Record<string, Profession> = {
  doctor: {
    name: "doctor",
    description: "Clinician; scans for patient/record data, intolerant of ambiguity in critical actions.",
    vocabulary: ["patient", "record", "chart", "diagnosis", "prescription", "dosage", "history", "vitals", "allergy", "referral"],
    workflowPriorities: ["search", "profile", "edit", "confirmation"],
    traitDeltas: { techLiteracy: 0.1, riskTolerance: -0.15, thoroughness: 0.15, patience: -0.1 },
    habits: ["Double-checks before any irreversible clinical action", "Scans for patient identifiers first"],
  },
  teacher: {
    name: "teacher",
    description: "Educator; organizes content, expects rosters, assignments, grading flows.",
    vocabulary: ["student", "class", "assignment", "grade", "roster", "lesson", "quiz", "attendance", "course", "submit"],
    workflowPriorities: ["create", "dashboard", "export", "settings"],
    traitDeltas: { thoroughness: 0.1, patience: 0.1 },
    habits: ["Groups tasks by class", "Looks for bulk actions"],
  },
  lawyer: {
    name: "lawyer",
    description: "Precise, risk-averse; reads terms carefully, expects document and version workflows.",
    vocabulary: ["document", "contract", "clause", "version", "signature", "case", "matter", "filing", "deadline", "review"],
    workflowPriorities: ["edit", "export", "confirmation", "search"],
    traitDeltas: { thoroughness: 0.25, riskTolerance: -0.2, readingSpeedWpm: -40, patience: 0.1 },
    habits: ["Reads confirmations in full", "Verifies version/date before acting"],
  },
  designer: {
    name: "designer",
    description: "Visually literate; notices layout, spacing, hierarchy; expects preview and undo.",
    vocabulary: ["layer", "canvas", "asset", "preview", "export", "typography", "palette", "component", "frame", "align"],
    workflowPriorities: ["create", "edit", "export"],
    traitDeltas: { techLiteracy: 0.15, experimentation: 0.2, curiosity: 0.15 },
    habits: ["Notices visual inconsistency immediately", "Expects undo/redo"],
  },
  accountant: {
    name: "accountant",
    description: "Numeric, meticulous; expects tables, reconciliation, exports, audit trails.",
    vocabulary: ["invoice", "ledger", "balance", "reconcile", "transaction", "report", "tax", "export", "total", "audit"],
    workflowPriorities: ["export", "import", "search", "edit"],
    traitDeltas: { thoroughness: 0.2, riskTolerance: -0.15, techLiteracy: 0.1 },
    habits: ["Verifies totals", "Prefers export to CSV/spreadsheet"],
  },
  student: {
    name: "student",
    description: "Time-pressed learner; quick, exploratory, cost-sensitive.",
    vocabulary: ["course", "assignment", "deadline", "notes", "submit", "grade", "free", "study", "download", "signup"],
    workflowPriorities: ["signup", "search", "download"],
    traitDeltas: { curiosity: 0.15, experimentation: 0.15, patience: -0.1, motorSpeed: 0.1 },
    habits: ["Hunts for free tiers", "Skims aggressively"],
  },
  salesperson: {
    name: "salesperson",
    description: "Relationship- and pipeline-oriented; expects contacts, deals, follow-ups.",
    vocabulary: ["lead", "contact", "deal", "pipeline", "follow up", "quote", "account", "opportunity", "close", "email"],
    workflowPriorities: ["create", "search", "notifications", "dashboard"],
    traitDeltas: { motorSpeed: 0.15, patience: -0.15, experimentation: 0.1 },
    habits: ["Wants speed over thoroughness", "Looks for quick-add"],
  },
  executive: {
    name: "executive",
    description: "Overview-first; scans summaries and KPIs, delegates detail, very impatient.",
    vocabulary: ["overview", "summary", "report", "metric", "kpi", "revenue", "growth", "team", "approve", "export"],
    workflowPriorities: ["dashboard", "export", "confirmation"],
    traitDeltas: { patience: -0.25, thoroughness: -0.2, readingSpeedWpm: 60, techLiteracy: 0.05 },
    habits: ["Reads only headlines/KPIs", "Delegates anything detailed"],
  },
};

export function listProfessions(): readonly Profession[] {
  return Object.values(PROFESSIONS);
}

export function getProfession(name: string): Profession {
  const p = PROFESSIONS[name];
  if (!p) throw new Error(`Unknown profession "${name}". Known: ${Object.keys(PROFESSIONS).join(", ")}`);
  return p;
}

/** Apply a profession overlay to a base persona, returning a new persona. */
export function applyProfession(base: Persona, profession: Profession): Persona {
  const traits = { ...base.traits };
  for (const [key, delta] of Object.entries(profession.traitDeltas) as Array<[keyof Persona["traits"], number]>) {
    if (key === "readingSpeedWpm") {
      traits[key] = Math.max(40, Math.min(1200, traits[key] + delta));
    } else {
      traits[key] = Math.max(0, Math.min(1, traits[key] + delta));
    }
  }
  return definePersona({
    name: `${base.name}/${profession.name}`,
    description: `${base.description} — as a ${profession.name}: ${profession.description}`,
    traits,
    accessibility: base.accessibility,
    disposition: base.disposition,
  });
}
