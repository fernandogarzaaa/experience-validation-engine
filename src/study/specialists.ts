/**
 * The specialist panel — six independent "researcher" agents that each read a
 * population study through one professional lens and file their own report.
 * Every observation is grounded in a concrete statistic from the study, so the
 * panel is interpretable and deterministic (no hidden model calls).
 */

import type { PopulationStudy, AggregatedFinding } from "../population/population.js";
import type { StudyObservation, Recommendation, SpecialistReport, Severity, Stance } from "./types.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Confidence grows with sample size — a bigger study is more trustworthy. */
function sizeConfidence(size: number): number {
  return clamp01(0.4 + 0.5 * (Math.min(size, 40) / 40));
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };

function worstSeverity(observations: readonly StudyObservation[]): Severity {
  let worst: Severity = "info";
  for (const o of observations) {
    if (SEVERITY_ORDER[o.severity] < SEVERITY_ORDER[worst]) worst = o.severity;
  }
  return worst;
}

function stanceFor(observations: readonly StudyObservation[]): Stance {
  switch (worstSeverity(observations)) {
    case "critical":
      return "block";
    case "major":
      return "caution";
    default:
      return "ship";
  }
}

function assemble(
  role: string,
  summary: string,
  observations: StudyObservation[],
  recommendations: Recommendation[],
  size: number,
  confidenceBoost = 0,
): SpecialistReport {
  return {
    role,
    summary,
    confidence: clamp01(sizeConfidence(size) + confidenceBoost),
    stance: stanceFor(observations),
    observations,
    recommendations: recommendations.sort((a, b) => b.priority - a.priority),
  };
}

function findingsByCategory(study: PopulationStudy, categories: readonly string[]): AggregatedFinding[] {
  return study.topFindings.filter((f) => categories.includes(f.category));
}

/** UX Researcher — task success, drop-off, and the shape of the population. */
export function uxResearcher(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  observations.push({
    statement: `${pct(study.successRate)} of the population completed; ${pct(study.dropoffRate)} abandoned.`,
    evidence: `n=${study.size}, overall score mean ${study.overallScore.mean} (sd ${study.overallScore.stdDev}).`,
    severity: study.successRate < 0.5 ? "critical" : study.dropoffRate > 0.15 ? "major" : "minor",
  });

  const failing = study.segments.find(
    (s) => s.key === "frustrated-quitters" || s.key === "early-abandoners" || s.key === "confused-wanderers",
  );
  if (failing && failing.share >= 0.1) {
    observations.push({
      statement: `The "${failing.name}" segment is ${pct(failing.share)} of users.`,
      evidence: `${failing.size} operators, mean score ${failing.meanScore}. ${failing.description}`,
      severity: failing.share >= 0.3 ? "major" : "minor",
    });
    recommendations.push({
      action: `Design for the "${failing.name}" segment — they are your biggest loss.`,
      rationale: `${pct(failing.share)} of the population falls here at mean score ${failing.meanScore}.`,
      priority: Math.round(60 + failing.share * 40),
    });
  }

  const dropScreen = [...study.navigationHeatmap].sort((a, b) => b.dropoffs - a.dropoffs)[0];
  if (dropScreen && dropScreen.dropoffs > 0) {
    observations.push({
      statement: `Most abandonment happens on \`${dropScreen.screen}\`.`,
      evidence: `${dropScreen.dropoffs} operators gave up there.`,
      severity: "major",
    });
    recommendations.push({
      action: `Run a focused usability pass on \`${dropScreen.screen}\`.`,
      rationale: `It is the single largest drop-off point (${dropScreen.dropoffs} operators).`,
      priority: 70,
    });
  }

  return assemble(
    "UX Researcher",
    `${pct(study.successRate)} task success across ${study.size} simulated users.`,
    observations,
    recommendations,
    study.size,
  );
}

/** Accessibility Specialist — a11y/visual findings and at-risk personas. */
export function accessibilitySpecialist(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  const a11y = findingsByCategory(study, ["accessibility", "visual"]);
  for (const f of a11y.slice(0, 3)) {
    observations.push({
      statement: f.title,
      evidence: `Hit by ${f.operatorsAffected} operators (${pct(f.prevalence)})${f.evidence ? ` — ${f.evidence}` : ""}.`,
      severity: (f.severity as Severity) === "critical" ? "critical" : "major",
    });
  }

  const atRisk = study.operators.filter((o) => /accessib|elderly/i.test(o.persona));
  if (atRisk.length) {
    const completed = atRisk.filter((o) => o.completed).length;
    observations.push({
      statement: `Accessibility-sensitive personas completed ${completed}/${atRisk.length} of the time.`,
      evidence: `Personas matching accessibility/elderly across the population.`,
      severity: completed < atRisk.length / 2 ? "critical" : "minor",
    });
  }

  if (a11y.length) {
    recommendations.push({
      action: "Fix contrast and target-size violations before release.",
      rationale: `${a11y.length} distinct accessibility/visual findings recurred across the population.`,
      priority: 80,
    });
  }

  if (observations.length === 0) {
    observations.push({
      statement: "No accessibility or visual findings recurred across the population.",
      evidence: `Scanned ${study.topFindings.length} population-wide findings.`,
      severity: "info",
    });
  }

  return assemble(
    "Accessibility Specialist",
    a11y.length ? `${a11y.length} accessibility/visual issues recur population-wide.` : "No systemic accessibility issues detected.",
    observations,
    recommendations,
    study.size,
  );
}

/** QA Engineer — reproducible broken affordances and error-recovery gaps. */
export function qaEngineer(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  const broken = study.topFindings.filter(
    (f) => f.category === "error-recovery" || /no visible response/i.test(f.title),
  );
  for (const f of broken.slice(0, 4)) {
    observations.push({
      statement: f.title,
      evidence: `Reproduced by ${f.operatorsAffected} operators (${pct(f.prevalence)}).`,
      severity: f.prevalence >= 0.5 ? "critical" : "major",
    });
  }

  if (broken.some((f) => f.prevalence >= 0.5)) {
    recommendations.push({
      action: "Treat the majority-reproduced no-feedback interactions as release-blocking defects.",
      rationale: "An interaction that silently does nothing for most users is a functional defect, not a nitpick.",
      priority: 90,
    });
  }

  if (observations.length === 0) {
    observations.push({
      statement: "No broken or silent interactions reproduced across the population.",
      evidence: "No error-recovery or no-feedback findings surfaced.",
      severity: "info",
    });
  }

  return assemble(
    "QA Engineer",
    broken.length ? `${broken.length} reproducible interaction defects.` : "No reproducible interaction defects.",
    observations,
    recommendations,
    study.size,
  );
}

/** Interaction Designer — navigation efficiency and dead-ends. */
export function interactionDesigner(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  const steps = study.stepsToComplete;
  if (steps.count > 0 && study.goal) {
    // Goal-directed: a long path to a known goal is real friction.
    observations.push({
      statement: `Completers reached the goal in a median of ${steps.median} steps (up to ${steps.max}).`,
      evidence: `Steps-to-complete distribution over ${steps.count} successful operators.`,
      severity: steps.median > 20 ? "major" : "minor",
    });
    if (steps.median > 20) {
      recommendations.push({
        action: "Shorten the primary path — the happy path is too long.",
        rationale: `Even successful users needed a median of ${steps.median} steps.`,
        priority: 65,
      });
    }
  } else if (steps.count > 0) {
    // Open-ended (no goal): "completed" just means "didn't abandon", so step
    // counts reflect exploration depth (and cluster at the budget), not path
    // length — report it neutrally rather than as friction.
    observations.push({
      statement: `Open-ended sessions explored a median of ${steps.median} steps.`,
      evidence: `No goal was set, so this reflects exploration depth, not path length.`,
      severity: "info",
    });
  }

  const churny = [...study.navigationHeatmap]
    .filter((e) => e.operators > 0)
    .sort((a, b) => b.visits / Math.max(1, b.operators) - a.visits / Math.max(1, a.operators))[0];
  if (churny && churny.visits / Math.max(1, churny.operators) >= 3) {
    observations.push({
      statement: `\`${churny.screen}\` is revisited heavily (${(churny.visits / churny.operators).toFixed(1)}× per operator).`,
      evidence: `${churny.visits} visits across ${churny.operators} operators — a sign of back-and-forth searching.`,
      severity: "major",
    });
    recommendations.push({
      action: `Clarify wayfinding around \`${churny.screen}\`.`,
      rationale: "Repeated revisits indicate users cannot tell where to go next.",
      priority: 60,
    });
  }

  if (observations.length === 0) {
    observations.push({
      statement: "Navigation was efficient — no excessive revisiting or long paths.",
      evidence: `${study.navigationHeatmap.length} screens observed.`,
      severity: "info",
    });
  }

  return assemble(
    "Interaction Designer",
    "Navigation efficiency and wayfinding assessment.",
    observations,
    recommendations,
    study.size,
  );
}

/** Behavioral Psychologist — the emotional arc of the population. */
export function behavioralPsychologist(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  observations.push({
    statement: `End-state frustration averaged ${study.frustration.mean}, trust ${study.trust.mean}, confidence ${study.confidence.mean}.`,
    evidence: `Frustration p75 ${study.frustration.p75}, trust p25 ${study.trust.p25}.`,
    severity: study.frustration.mean > 0.5 ? "major" : study.frustration.mean > 0.3 ? "minor" : "info",
  });

  const quitters = study.segments.find((s) => s.key === "frustrated-quitters");
  if (quitters && quitters.share > 0) {
    observations.push({
      statement: `${pct(quitters.share)} of users churned specifically out of frustration.`,
      evidence: `${quitters.size} operators in the "frustrated-quitters" segment.`,
      severity: quitters.share >= 0.2 ? "major" : "minor",
    });
  }

  if (study.trust.mean < 0.5) {
    observations.push({
      statement: "Trust ended below the neutral baseline for the average user.",
      evidence: `Mean trust ${study.trust.mean} (baseline ≈ 0.6).`,
      severity: "major",
    });
    recommendations.push({
      action: "Add feedback and predictability to rebuild trust (clear responses, consistent behavior).",
      rationale: "Trust builds slowly and breaks fast; the population ended net-distrustful.",
      priority: 55,
    });
  }

  if (study.frustration.mean > 0.4) {
    recommendations.push({
      action: "Target the highest-frustration moments identified in the journey.",
      rationale: `Mean end-state frustration is ${study.frustration.mean}.`,
      priority: 58,
    });
  }

  return assemble(
    "Behavioral Psychologist",
    `Population ended at ${study.frustration.mean} frustration / ${study.trust.mean} trust.`,
    observations,
    recommendations,
    study.size,
  );
}

/** Product Manager — where a fix buys the most completion. */
export function productManager(study: PopulationStudy): SpecialistReport {
  const observations: StudyObservation[] = [];
  const recommendations: Recommendation[] = [];

  const leverage = [...study.topFindings]
    .filter((f) => f.severity === "critical" || f.severity === "major")
    .sort((a, b) => b.prevalence - a.prevalence)[0];

  observations.push({
    statement: `Success rate is ${pct(study.successRate)}; the business question is what lifts it fastest.`,
    evidence: `Drop-off ${pct(study.dropoffRate)} across ${study.size} users.`,
    severity: study.successRate < 0.5 ? "critical" : "minor",
  });

  if (leverage) {
    observations.push({
      statement: `Highest-leverage fix: "${leverage.title}".`,
      evidence: `Affects ${pct(leverage.prevalence)} of users — the widest-reaching serious issue.`,
      severity: leverage.severity as Severity,
    });
    recommendations.push({
      action: leverage.recommendation ?? `Resolve "${leverage.title}".`,
      rationale: `Reaches ${pct(leverage.prevalence)} of the population; likely the largest single lift to completion.`,
      priority: Math.round(70 + leverage.prevalence * 25),
    });
  }

  return assemble(
    "Product Manager",
    `${pct(study.successRate)} success — prioritizing the highest-leverage fix.`,
    observations,
    recommendations,
    study.size,
  );
}

/** The full specialist panel, in report order. */
export const SPECIALISTS: readonly ((study: PopulationStudy) => SpecialistReport)[] = [
  uxResearcher,
  interactionDesigner,
  accessibilitySpecialist,
  qaEngineer,
  behavioralPsychologist,
  productManager,
];

/** Run every specialist against the study. */
export function runSpecialists(study: PopulationStudy): SpecialistReport[] {
  return SPECIALISTS.map((fn) => fn(study));
}
