/**
 * Core implementations behind the EVE MCP tools.
 *
 * These functions are deliberately transport-agnostic and side-effect-light
 * (they never write to stdout), so they can be unit-tested directly and reused
 * programmatically. `server.ts` is a thin adapter that wires them to the MCP
 * TypeScript SDK.
 *
 * Each returns `{ markdown, structured }`: a human-readable rendering plus the
 * full machine-readable object, letting callers pick a response format.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createAdapter } from "../browser/index.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import { UtilityCognition } from "../cognition/utilityCognition.js";
import type { DecisionPolicy } from "../cognition/cognition.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import { FileMemoryStore } from "../memory/longTerm.js";
import { validateBenchmarks } from "../benchmarks/index.js";
import { writeReports } from "../reporting/index.js";
import {
  getPersona,
  listPersonas,
  getProfession,
  listProfessions,
  applyProfession,
  getCulture,
  listCultures,
  type Persona,
} from "../personas/index.js";
import type {
  RunSessionInput,
  BenchmarkInput,
  GetReportInput,
} from "./schemas.js";

/** Maximum characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Maximum number of findings itemized inline in a run summary. */
const MAX_INLINE_FINDINGS = 12;

export interface ToolOutput {
  readonly markdown: string;
  readonly structured: Record<string, unknown>;
}

/**
 * A caller-facing error whose message is safe and actionable to surface to an
 * LLM. Thrown for bad input (unknown persona, missing browser, …).
 */
export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n…[truncated ${text.length - CHARACTER_LIMIT} characters — read the ` +
    `full report file with eve_get_report]`
  );
}

function severityRank(severity: string): number {
  switch (severity) {
    case "critical":
      return 0;
    case "major":
      return 1;
    case "minor":
      return 2;
    default:
      return 3;
  }
}

/** Pick the most telling first-person rationale lines from the journal. */
function journalHighlights(result: SessionResult, limit = 3): string[] {
  const scored = result.iterations
    .map((it) => ({
      step: it.step,
      frustration: it.emotion.frustration ?? 0,
      line: `Step ${it.step}: ${it.rationale}`,
    }))
    .sort((a, b) => b.frustration - a.frustration)
    .slice(0, limit)
    .sort((a, b) => a.step - b.step);
  return scored.map((s) => s.line);
}

function resolvePersona(input: RunSessionInput): Persona {
  let persona: Persona;
  try {
    persona = getPersona(input.persona);
  } catch {
    const names = listPersonas()
      .map((p) => p.name)
      .join(", ");
    throw new ToolInputError(
      `Unknown persona "${input.persona}". Available personas: ${names}. ` +
        `(Call eve_list_personas for descriptions.)`,
    );
  }
  if (input.profession) {
    try {
      persona = applyProfession(persona, getProfession(input.profession));
    } catch {
      const names = listProfessions()
        .map((p) => p.name)
        .join(", ");
      throw new ToolInputError(
        `Unknown profession "${input.profession}". Available: ${names}. ` +
          `(Call eve_list_professions.)`,
      );
    }
  }
  return persona;
}

function resolveCulture(input: RunSessionInput): string | undefined {
  if (!input.culture) return undefined;
  try {
    return getCulture(input.culture).locale;
  } catch {
    const locales = listCultures()
      .map((c) => c.locale)
      .join(", ");
    throw new ToolInputError(
      `Unknown culture "${input.culture}". Available locales: ${locales}. ` +
        `(Call eve_list_cultures.)`,
    );
  }
}

/**
 * Run one simulated-human session and write the full report to disk.
 * Progress is not logged to stdout (safe for stdio MCP transport); set
 * EVE_MCP_DEBUG=1 to route progress to stderr.
 */
export async function runSession(input: RunSessionInput): Promise<ToolOutput> {
  const persona = resolvePersona(input);
  const culture = resolveCulture(input);

  const isMock = input.url.startsWith("mock:");
  const browser = input.browser ?? (isMock ? "mock" : "playwright");

  const policy: DecisionPolicy = input.utility
    ? new UtilityCognition()
    : new HeuristicCognition();

  const longTermMemory = input.remember_file
    ? new FileMemoryStore(input.remember_file)
    : undefined;

  const debug = process.env.EVE_MCP_DEBUG === "1";
  const onLog = debug
    ? (line: string) => process.stderr.write(`[eve] ${line}\n`)
    : undefined;

  let adapter;
  try {
    adapter = createAdapter(browser, { headless: true });
  } catch (err) {
    throw new ToolInputError(
      `Could not start the "${browser}" browser backend: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const session = new EveSession({
    adapter,
    startUrl: input.url,
    persona,
    policy,
    goal: input.goal,
    goalSuccessSignals: input.goal_success_signals,
    seed: input.seed,
    maxSteps: input.max_steps,
    maxDurationMs: input.max_minutes * 60 * 1000,
    screenshots: input.screenshots && browser !== "mock",
    cognitive: input.cognitive,
    culture,
    longTermMemory,
    ...(onLog ? { onLog } : {}),
  });

  const result = await session.run();
  const written = await writeReports(result, input.output_dir);

  const bySeverity = { critical: 0, major: 0, minor: 0, other: 0 };
  for (const f of result.findings) {
    if (f.severity in bySeverity) {
      bySeverity[f.severity as keyof typeof bySeverity] += 1;
    } else {
      bySeverity.other += 1;
    }
  }

  const overall = result.scores.find((s) => s.dimension === "overall")?.value ?? 0;
  const topFindings = [...result.findings]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, MAX_INLINE_FINDINGS)
    .map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      evidence: f.evidence[0] ?? null,
      recommendation: f.recommendation ?? null,
    }));

  const structured = {
    url: input.url,
    persona: result.personaName,
    profession: input.profession ?? null,
    culture: result.culture,
    browser,
    seed: result.seed,
    goal: input.goal ?? null,
    overallScore: overall,
    scores: result.scores.map((s) => ({ dimension: s.dimension, value: s.value })),
    outcome: {
      endReason: result.endReason,
      goalAchieved: result.goalAchieved,
      abandoned: result.abandoned,
      abandonReason: result.abandonReason,
    },
    usage: {
      steps: result.usage.steps,
      durationMinutes: Number((result.usage.durationMs / 60000).toFixed(1)),
      screensVisited: result.usage.screensVisited,
    },
    findings: {
      total: result.findings.length,
      ...bySeverity,
      items: topFindings,
      truncated: result.findings.length > topFindings.length,
    },
    learning: result.learningMetrics
      ? {
          sessions: result.learningMetrics.sessions,
          learningRate: result.learningMetrics.learningRate,
          steps: result.learningMetrics.stepsSeries,
        }
      : null,
    cognitiveLoad: result.cognitiveLoad
      ? { mean: result.cognitiveLoad.meanIndex, peak: result.cognitiveLoad.peakIndex }
      : null,
    journalHighlights: journalHighlights(result),
    reports: written,
  };

  const lines: string[] = [
    `# EVE session — ${result.personaName} on ${input.url}`,
    "",
    `**Overall experience score:** ${overall}/100`,
    `**Outcome:** ${result.endReason}` +
      (result.abandonReason ? ` — ${result.abandonReason}` : ""),
    `**Findings:** ${bySeverity.critical} critical, ${bySeverity.major} major, ` +
      `${bySeverity.minor + bySeverity.other} other`,
    `**Steps / simulated time:** ${result.usage.steps} / ` +
      `${(result.usage.durationMs / 60000).toFixed(1)} min`,
  ];
  if (structured.learning) {
    const l = structured.learning;
    lines.push(
      `**Learning (this app):** session ${l.sessions}, learning rate ` +
        `${l.learningRate}, steps ${l.steps.join("→")}`,
    );
  }
  if (structured.cognitiveLoad) {
    lines.push(
      `**Cognitive load:** mean ${structured.cognitiveLoad.mean}, peak ` +
        `${structured.cognitiveLoad.peak}`,
    );
  }
  lines.push("");
  if (topFindings.length) {
    lines.push("## Top findings");
    for (const f of topFindings) {
      lines.push(`- **[${f.severity}] ${f.title}**` + (f.evidence ? ` — ${f.evidence}` : ""));
      if (f.recommendation) lines.push(`  - Fix: ${f.recommendation}`);
    }
    lines.push("");
  }
  if (structured.journalHighlights.length) {
    lines.push("## Journal highlights (why the user reacted)");
    for (const h of structured.journalHighlights) lines.push(`- ${h}`);
    lines.push("");
  }
  lines.push(
    `Full report: ${written.markdown} · ${written.html} · ${written.json}`,
    `Read the full markdown back with eve_get_report(output_dir="${input.output_dir}").`,
  );

  return { markdown: truncate(lines.join("\n")), structured };
}

/** List the built-in personas. */
export function listPersonasTool(): ToolOutput {
  const personas = listPersonas().map((p) => ({ name: p.name, description: p.description }));
  const markdown = [
    "# EVE personas",
    "",
    ...personas.map((p) => `- **${p.name}** — ${p.description}`),
  ].join("\n");
  return { markdown, structured: { count: personas.length, personas } };
}

/** List the professional overlays. */
export function listProfessionsTool(): ToolOutput {
  const professions = listProfessions().map((p) => ({
    name: p.name,
    description: p.description,
  }));
  const markdown = [
    "# EVE professional overlays",
    "",
    ...professions.map((p) => `- **${p.name}** — ${p.description}`),
  ].join("\n");
  return { markdown, structured: { count: professions.length, professions } };
}

/** List the cultural profiles. */
export function listCulturesTool(): ToolOutput {
  const cultures = listCultures().map((c) => ({
    locale: c.locale,
    name: c.name,
    readingDirection: c.readingDirection,
    currency: c.currency,
    dateFormat: c.dateFormat,
  }));
  const markdown = [
    "# EVE cultural profiles",
    "",
    ...cultures.map(
      (c) =>
        `- **${c.locale}** (${c.name}) — ${c.readingDirection.toUpperCase()}, ` +
        `${c.currency}, ${c.dateFormat}`,
    ),
  ].join("\n");
  return { markdown, structured: { count: cultures.length, cultures } };
}

/** Validate EVE against the known-quality benchmark apps (construct validity). */
export async function runBenchmark(input: BenchmarkInput): Promise<ToolOutput> {
  const validation = await validateBenchmarks({ cognitive: input.cognitive });
  const structured = {
    ordered: validation.ordered,
    summary: validation.summary,
    results: validation.results.map((r) => ({ tier: r.tier, meanScore: r.meanScore })),
  };
  const markdown = [
    "# EVE benchmark (construct validity)",
    "",
    ...validation.results.map((r) => `- **${r.tier}** — mean score ${r.meanScore}/100`),
    "",
    validation.summary,
    "",
    validation.ordered
      ? "✅ EVE ranked the reference apps correctly."
      : "❌ EVE could not rank the reference apps — the instrument is miscalibrated.",
  ].join("\n");
  return { markdown, structured };
}

/** Read a previously written report back from disk. */
export async function getReport(input: GetReportInput): Promise<ToolOutput> {
  const file = input.format === "json" ? "report.json" : "report.md";
  const path = join(input.output_dir, file);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new ToolInputError(
      `No ${file} found in "${input.output_dir}". Run eve_run_session with ` +
        `output_dir="${input.output_dir}" first.`,
    );
  }
  return {
    markdown: truncate(content),
    structured: { path, format: input.format, content: truncate(content) },
  };
}
