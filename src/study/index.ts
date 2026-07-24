/**
 * AI-moderated user study — a panel of specialist researcher agents (UX
 * Researcher, Interaction Designer, Accessibility Specialist, QA Engineer,
 * Behavioral Psychologist, Product Manager) that each analyze a population
 * study, reconciled by a moderator into one executive report.
 */

export { moderateStudy } from "./moderator.js";
export { renderModeratedStudyMarkdown } from "./report.js";
export {
  runSpecialists,
  SPECIALISTS,
  uxResearcher,
  interactionDesigner,
  accessibilitySpecialist,
  qaEngineer,
  behavioralPsychologist,
  productManager,
} from "./specialists.js";
export type {
  ExecutiveStudyReport,
  SpecialistReport,
  StudyObservation,
  Recommendation,
  ConsensusPoint,
  Conflict,
  PriorityItem,
  Severity,
  Stance,
  Verdict,
} from "./types.js";
