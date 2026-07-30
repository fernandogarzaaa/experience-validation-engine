/**
 * AI-moderated user study — a panel of specialist researcher agents (UX
 * Researcher, Interaction Designer, Accessibility Specialist, QA Engineer,
 * Behavioral Psychologist, Product Manager) that each analyze a population
 * study, reconciled by a moderator into one executive report.
 */

export { moderateStudy } from "./moderator.js";
export { renderModeratedStudyMarkdown } from "./report.js";
export {
  accessibilitySpecialist,
  behavioralPsychologist,
  interactionDesigner,
  productManager,
  qaEngineer,
  runSpecialists,
  SPECIALISTS,
  uxResearcher,
} from "./specialists.js";
export type {
  Conflict,
  ConsensusPoint,
  ExecutiveStudyReport,
  PriorityItem,
  Recommendation,
  Severity,
  SpecialistReport,
  Stance,
  StudyObservation,
  Verdict,
} from "./types.js";
