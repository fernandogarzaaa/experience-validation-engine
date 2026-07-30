import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionResult } from "../engine/session.js";
import { renderHtml } from "./html.js";
import { renderMarkdown } from "./markdown.js";
import { buildReport, type ExperienceReport } from "./report.js";

export { renderHtml } from "./html.js";
export { renderMarkdown } from "./markdown.js";
export { renderPanelMarkdown } from "./panelReport.js";
export type { ExperienceReport } from "./report.js";
export { buildReport } from "./report.js";

/** JSON rendering strips raw screenshot buffers (kept in HTML instead). */
export function renderJson(report: ExperienceReport): string {
  const { result } = report;
  return JSON.stringify(
    {
      generatedAt: report.generatedAt,
      executiveSummary: report.executiveSummary,
      overallScore: report.overallScore,
      quickWins: report.quickWins,
      longTermImprovements: report.longTermImprovements,
      startUrl: result.startUrl,
      personaName: result.personaName,
      seed: result.seed,
      endReason: result.endReason,
      goalAchieved: result.goalAchieved,
      abandoned: result.abandoned,
      abandonReason: result.abandonReason,
      appTheory: result.appTheory,
      usage: result.usage,
      scores: result.scores,
      findings: result.findings,
      workflows: result.workflows.map((w) => ({
        kind: w.kind,
        completed: w.completed,
        errorCount: w.errorCount,
        screens: w.screens.map((s) => ({ url: s.url, title: s.title, visits: s.visits })),
      })),
      emotionTimeline: result.emotionTimeline,
      iterations: result.iterations.map((it) => ({
        ...it,
        action: { kind: it.action.kind },
      })),
    },
    null,
    2,
  );
}

export interface WrittenReport {
  readonly html: string;
  readonly markdown: string;
  readonly json: string;
}

/** Build a report from a session result and write all three formats. */
export async function writeReports(
  result: SessionResult,
  outputDir: string,
): Promise<WrittenReport> {
  const report = buildReport(result);
  await mkdir(outputDir, { recursive: true });
  const htmlPath = join(outputDir, "report.html");
  const mdPath = join(outputDir, "report.md");
  const jsonPath = join(outputDir, "report.json");
  await writeFile(htmlPath, renderHtml(report), "utf8");
  await writeFile(mdPath, renderMarkdown(report), "utf8");
  await writeFile(jsonPath, renderJson(report), "utf8");
  return { html: htmlPath, markdown: mdPath, json: jsonPath };
}
