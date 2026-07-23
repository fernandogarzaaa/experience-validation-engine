import type { ProductPlan, Epic, UserStory } from "./productManager.js";
import type { ExecutiveReport } from "./moderator.js";

/**
 * Developer AI.
 *
 * Translates the product plan into concrete, trackable engineering work
 * items in the format of common trackers: GitHub Issues, Linear issues, Jira
 * tickets, and plain Markdown task lists. Output is data + serializers, so it
 * can be piped straight into an API client or written to disk — no network
 * calls are made here (integration is the caller's choice).
 */

export interface DevTicket {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
  readonly priority: "urgent" | "high" | "medium" | "low";
  readonly estimate: "S" | "M" | "L";
  readonly acceptanceCriteria: readonly string[];
}

export function generateTickets(plan: ProductPlan, executive: ExecutiveReport): DevTicket[] {
  const tickets: DevTicket[] = [];
  for (const epic of plan.epics) {
    for (const story of epic.stories) {
      tickets.push(ticketFromStory(epic, story, executive));
    }
  }
  return tickets;
}

function ticketFromStory(epic: Epic, story: UserStory, executive: ExecutiveReport): DevTicket {
  const priority: DevTicket["priority"] =
    story.severity === "critical" ? "urgent" : story.severity === "major" ? "high" : "medium";
  const estimate: DevTicket["estimate"] =
    epic.priorityScore >= 0.8 ? "M" : epic.priorityScore >= 0.3 ? "M" : "L";
  const body = [
    `**User story:** As a ${story.asA}, I want ${story.iWant}, so that ${story.soThat}.`,
    "",
    `**Problem (from EVE simulation):** ${epic.problem}`,
    "",
    `**Business impact:** ${epic.businessImpact}`,
    "",
    `**Evidence:** Surfaced by simulated experience validation across ${executive.personaCount} persona(s); mean experience score ${executive.meanOverallScore}/100.`,
    "",
    "**Acceptance criteria:**",
    ...story.acceptanceCriteria.map((c) => `- [ ] ${c}`),
    "",
    `_Epic: ${epic.id} · Priority score: ${epic.priorityScore} · Est. completion lift: +${Math.round(epic.estimatedCompletionLift * 100)}%_`,
  ].join("\n");

  return {
    key: story.id,
    title: story.title,
    body,
    labels: ["ux", "eve-generated", `severity:${story.severity}`],
    priority,
    estimate,
    acceptanceCriteria: story.acceptanceCriteria,
  };
}

/* ------------------------------------------------------------------ */
/* Serializers                                                        */
/* ------------------------------------------------------------------ */

/** GitHub Issues (one Markdown block per ticket, ready for the API `body`). */
export function toGitHubIssues(tickets: readonly DevTicket[]): Array<{ title: string; body: string; labels: string[] }> {
  return tickets.map((t) => ({
    title: t.title,
    body: `${t.body}\n\n_Priority: ${t.priority} · Estimate: ${t.estimate}_`,
    labels: [...t.labels],
  }));
}

/** Linear issues (title/description/priority as Linear's 0–4 scale). */
export function toLinearIssues(
  tickets: readonly DevTicket[],
): Array<{ title: string; description: string; priority: number; labels: string[] }> {
  const priorityMap = { urgent: 1, high: 2, medium: 3, low: 4 } as const;
  return tickets.map((t) => ({
    title: t.title,
    description: t.body,
    priority: priorityMap[t.priority],
    labels: [...t.labels],
  }));
}

/** Jira tickets (summary/description/priority/issuetype). */
export function toJiraIssues(
  tickets: readonly DevTicket[],
): Array<{ summary: string; description: string; priority: string; issuetype: string; labels: string[] }> {
  const priorityMap = { urgent: "Highest", high: "High", medium: "Medium", low: "Low" } as const;
  return tickets.map((t) => ({
    summary: t.title,
    description: t.body,
    priority: priorityMap[t.priority],
    issuetype: "Story",
    labels: t.labels.map((l) => l.replace(/[^a-zA-Z0-9_-]/g, "_")),
  }));
}

/** A single Markdown task document. */
export function toMarkdownTasks(tickets: readonly DevTicket[], title = "EVE-generated UX backlog"): string {
  const lines = [`# ${title}`, ""];
  for (const t of tickets) {
    lines.push(`## ${t.key} — ${t.title}`);
    lines.push(`> Priority: **${t.priority}** · Estimate: **${t.estimate}** · Labels: ${t.labels.join(", ")}`);
    lines.push("");
    lines.push(t.body);
    lines.push("");
  }
  return lines.join("\n");
}
