export { critiqueDesign } from "./designCritic.js";
export type { DesignCritique, CritiqueItem, Heuristic } from "./designCritic.js";
export { moderatePanel } from "./moderator.js";
export type { ExecutiveReport, ConsensusIssue, Disagreement } from "./moderator.js";
export { buildProductPlan } from "./productManager.js";
export type { ProductPlan, Epic, UserStory, RoadmapPhase } from "./productManager.js";
export {
  generateTickets,
  toGitHubIssues,
  toLinearIssues,
  toJiraIssues,
  toMarkdownTasks,
} from "./developer.js";
export type { DevTicket } from "./developer.js";

import type { SessionResult } from "../engine/session.js";
import { critiqueDesign } from "./designCritic.js";
import { moderatePanel, type ExecutiveReport } from "./moderator.js";
import { buildProductPlan, type ProductPlan } from "./productManager.js";
import { generateTickets, type DevTicket } from "./developer.js";
import { forecastExperience, type ExperienceForecast } from "../forecasting/forecast.js";
import type { DesignCritique } from "./designCritic.js";

export interface PanelResult {
  readonly executive: ExecutiveReport;
  readonly critique: DesignCritique;
  readonly forecast: ExperienceForecast;
  readonly plan: ProductPlan;
  readonly tickets: readonly DevTicket[];
}

/**
 * Run the full AI panel over a set of sessions: independent design critique,
 * experience forecast, moderator consensus, product plan, and developer
 * tickets. This is the end-to-end "team of AIs" pass.
 */
export function runPanel(sessions: readonly SessionResult[]): PanelResult {
  if (sessions.length === 0) throw new Error("runPanel requires at least one session");
  const screens = sessions.flatMap((s) => s.capturedScreens);
  const allFindings = sessions.flatMap((s) => [...s.findings]);
  const critique = critiqueDesign(screens, allFindings);
  const forecast = forecastExperience(sessions);
  const executive = moderatePanel({ sessions, critique, forecast });
  const plan = buildProductPlan({ executive, forecast, critique });
  const tickets = generateTickets(plan, executive);
  return { executive, critique, forecast, plan, tickets };
}
