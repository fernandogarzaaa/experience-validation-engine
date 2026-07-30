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

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildApplicationMap, renderApplicationMapMarkdown } from "../appmap/index.js";
import { validateBenchmarks } from "../benchmarks/index.js";
import type { AdapterName, BrowserAdapter } from "../browser/index.js";
import { createAdapter } from "../browser/index.js";
import type { HumanStudy } from "../calibration/index.js";
import { calibrate, importHumanStudy, renderCalibrationMarkdown } from "../calibration/index.js";
import type { DecisionPolicy } from "../cognition/cognition.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import { UtilityCognition } from "../cognition/utilityCognition.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import { renderEveBenchMarkdown, runEveBench } from "../evebench/index.js";
import { FileMemoryStore } from "../memory/longTerm.js";
import { analyzeMultimodal, renderMultimodalMarkdown } from "../multimodal/index.js";
import {
  applyProfession,
  getCulture,
  getPersona,
  getProfession,
  listCultures,
  listPersonas,
  listProfessions,
  type Persona,
} from "../personas/index.js";
import { simulatePopulation } from "../population/index.js";
import { predictUX, renderUXPredictionMarkdown } from "../predict/index.js";
import { inferProductIntelligence, renderProductIntelligenceMarkdown } from "../product/index.js";
import { writeReports } from "../reporting/index.js";
import { renderStudyMarkdown, writeStudyDataset } from "../research/index.js";
import { moderateStudy, renderModeratedStudyMarkdown } from "../study/index.js";
import { analyzeTrends, renderTrendReportMarkdown } from "../trends/index.js";
import { createTwin, FileTwinStore, renderTwinMarkdown, runTwinSession } from "../twins/index.js";
import type {
  ApplicationMapInput,
  BenchmarkInput,
  CalibrateInput,
  CompareBuildsInput,
  EveBenchInput,
  GetReportInput,
  MultimodalScanInput,
  RunSessionInput,
  RunUsabilityStudyInput,
  TwinSessionInput,
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
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n…[truncated ${text.length - CHARACTER_LIMIT} characters — read the full report file with eve_get_report]`;
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
      `Unknown persona "${input.persona}". Available personas: ${names}. (Call eve_list_personas for descriptions.)`,
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
        `Unknown profession "${input.profession}". Available: ${names}. (Call eve_list_professions.)`,
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
      `Unknown culture "${input.culture}". Available locales: ${locales}. (Call eve_list_cultures.)`,
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

  const policy: DecisionPolicy = input.utility ? new UtilityCognition() : new HeuristicCognition();

  const longTermMemory = input.remember_file ? new FileMemoryStore(input.remember_file) : undefined;

  const debug = process.env.EVE_MCP_DEBUG === "1";
  const onLog = debug ? (line: string) => process.stderr.write(`[eve] ${line}\n`) : undefined;

  let adapter: BrowserAdapter;
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
    `**Outcome:** ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}`,
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
      lines.push(`- **[${f.severity}] ${f.title}**${f.evidence ? ` — ${f.evidence}` : ""}`);
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

/**
 * Run a population usability study: simulate many varied operators against the
 * same app and aggregate the results statistically. Optionally writes the full
 * research dataset (JSON/CSV/Markdown) to disk.
 */
/** Map the shared study MCP input to `simulatePopulation` options. */
function toPopulationOptions(input: RunUsabilityStudyInput) {
  return {
    url: input.url,
    size: input.size,
    personas: input.personas.length ? input.personas : undefined,
    professions: input.professions.length ? input.professions : undefined,
    cultures: input.cultures.length ? input.cultures : undefined,
    goal: input.goal,
    goalSuccessSignals: input.goal_success_signals,
    seed: input.seed,
    maxSteps: input.max_steps,
    cognitive: input.cognitive,
    utility: input.utility,
    browser: input.browser as AdapterName | undefined,
    concurrency: input.concurrency,
  };
}

export async function runUsabilityStudy(input: RunUsabilityStudyInput): Promise<ToolOutput> {
  const study = await simulatePopulation(toPopulationOptions(input));

  let dataset: { json: string; csv: string; markdown: string } | null = null;
  if (input.output_dir) dataset = await writeStudyDataset(study, input.output_dir);

  // Keep the inline structured payload bounded: summary + a sample of
  // operators, with the full per-operator table available in the CSV/JSON.
  const { operators, ...summary } = study;
  const structured: Record<string, unknown> = {
    ...summary,
    operatorSample: operators.slice(0, 10),
    operatorCount: operators.length,
    dataset,
  };

  const markdown = truncate(
    renderStudyMarkdown(study) +
      (dataset
        ? `\n\nResearch dataset written to: ${dataset.markdown} · ${dataset.csv} · ${dataset.json}`
        : ""),
  );
  return { markdown, structured };
}

/**
 * Run a full AI-moderated user study: simulate a population, then convene the
 * specialist panel (UX Researcher, Interaction Designer, Accessibility
 * Specialist, QA Engineer, Behavioral Psychologist, Product Manager) and the
 * moderator synthesis. Returns an executive report with a release verdict.
 */
export async function runUserStudy(input: RunUsabilityStudyInput): Promise<ToolOutput> {
  const study = await simulatePopulation(toPopulationOptions(input));
  const report = moderateStudy(study);

  let files: { study: string; moderated: string } | null = null;
  if (input.output_dir) {
    const dataset = await writeStudyDataset(study, input.output_dir);
    const moderatedPath = join(input.output_dir, "moderated-study.md");
    await writeFile(moderatedPath, renderModeratedStudyMarkdown(report), "utf8");
    files = { study: dataset.markdown, moderated: moderatedPath };
  }

  const structured: Record<string, unknown> = {
    verdict: report.verdict,
    headline: report.headline,
    confidence: report.confidence,
    successRate: report.successRate,
    dropoffRate: report.dropoffRate,
    consensus: report.consensus,
    conflicts: report.conflicts,
    priorities: report.priorities,
    specialists: report.specialists.map((s) => ({
      role: s.role,
      stance: s.stance,
      confidence: s.confidence,
      summary: s.summary,
    })),
    files,
  };

  const markdown = truncate(
    renderModeratedStudyMarkdown(report) +
      (files ? `\n\nWritten: ${files.moderated} · ${files.study}` : ""),
  );
  return { markdown, structured };
}

/**
 * Run a population, then infer product intelligence from how it behaved:
 * personas, business goals, critical workflows, feature importance,
 * high-friction pages, and drop-off causes.
 */
export async function runProductReport(input: RunUsabilityStudyInput): Promise<ToolOutput> {
  const study = await simulatePopulation(toPopulationOptions(input));
  const intel = inferProductIntelligence(study);

  let file: string | null = null;
  if (input.output_dir) {
    await writeStudyDataset(study, input.output_dir);
    file = join(input.output_dir, "product-report.md");
    await writeFile(file, renderProductIntelligenceMarkdown(intel), "utf8");
  }

  const structured: Record<string, unknown> = { ...intel, file };
  const markdown = truncate(
    renderProductIntelligenceMarkdown(intel) + (file ? `\n\nWritten: ${file}` : ""),
  );
  return { markdown, structured };
}

/**
 * Study several builds and analyze the experience trend across them —
 * detecting improvements and regressions in success, drop-off, score,
 * confidence, frustration, trust, and effort.
 */
export async function compareBuilds(input: CompareBuildsInput): Promise<ToolOutput> {
  const builds: { label: string; study: Awaited<ReturnType<typeof simulatePopulation>> }[] = [];
  for (let i = 0; i < input.builds.length; i += 1) {
    const b = input.builds[i]!;
    const study = await simulatePopulation({
      url: b.url,
      size: input.size,
      goal: input.goal,
      goalSuccessSignals: input.goal_success_signals,
      seed: input.seed,
      maxSteps: input.max_steps,
      cognitive: input.cognitive,
      utility: input.utility,
      concurrency: input.concurrency,
    });
    builds.push({ label: b.label ?? b.url, study });
  }

  const report = analyzeTrends(builds);
  const markdown = truncate(renderTrendReportMarkdown(report));
  return { markdown, structured: { ...report } };
}

/**
 * Run a population, then predict the UX the wider user base will experience —
 * confusion, abandonment, onboarding failure, support contacts, and
 * accessibility barriers, each with a confidence interval.
 */
export async function runPredictUX(input: RunUsabilityStudyInput): Promise<ToolOutput> {
  const study = await simulatePopulation(toPopulationOptions(input));
  const prediction = predictUX(study);

  let file: string | null = null;
  if (input.output_dir) {
    file = join(input.output_dir, "ux-prediction.md");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(input.output_dir, { recursive: true });
    await writeFile(file, renderUXPredictionMarkdown(prediction), "utf8");
  }

  const structured: Record<string, unknown> = { ...prediction, file };
  const markdown = truncate(
    renderUXPredictionMarkdown(prediction) + (file ? `\n\nWritten: ${file}` : ""),
  );
  return { markdown, structured };
}

/**
 * Calibrate EVE against a human study: load anonymized human traces from a
 * file, run a matching EVE population, and score the simulation's realism.
 */
export async function runCalibrate(input: CalibrateInput): Promise<ToolOutput> {
  let human: HumanStudy;
  try {
    const raw = await readFile(input.human_file, "utf8");
    human = importHumanStudy(JSON.parse(raw));
  } catch (err) {
    throw new ToolInputError(
      `Could not read the human study at "${input.human_file}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const study = await simulatePopulation({
    url: input.url,
    size: input.size,
    goal: input.goal ?? human.task,
    goalSuccessSignals: input.goal_success_signals,
    seed: input.seed,
    maxSteps: input.max_steps,
    concurrency: input.concurrency,
  });

  const report = calibrate(human, study);
  const markdown = truncate(renderCalibrationMarkdown(report));
  return { markdown, structured: { ...report } };
}

/**
 * Run one session as a persistent digital twin, creating it on first use and
 * persisting its evolved profile (expertise, confidence, memory) to disk.
 */
export async function runTwinSessionTool(input: TwinSessionInput): Promise<ToolOutput> {
  const store = new FileTwinStore(input.twin_file);
  let twin = await store.load(input.twin_id);
  if (!twin) {
    if (!input.name || !input.base_persona) {
      throw new ToolInputError(
        `Twin "${input.twin_id}" does not exist yet — provide \`name\` and \`base_persona\` to create it.`,
      );
    }
    try {
      twin = createTwin({
        id: input.twin_id,
        name: input.name,
        basePersona: input.base_persona,
        ...(input.profession ? { profession: input.profession } : {}),
        ...(input.culture ? { culture: input.culture } : {}),
      });
    } catch (err) {
      throw new ToolInputError(err instanceof Error ? err.message : String(err));
    }
  }

  const isMock = input.url.startsWith("mock:");
  const browser = input.browser ?? (isMock ? "mock" : "playwright");
  let adapter: BrowserAdapter;
  try {
    adapter = createAdapter(browser as AdapterName, { headless: true });
  } catch (err) {
    throw new ToolInputError(
      `Could not start the "${browser}" browser backend: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { twin: updated, outcome } = await runTwinSession(twin, {
    adapter,
    url: input.url,
    goal: input.goal,
    goalSuccessSignals: input.goal_success_signals,
    seed: input.seed,
    maxSteps: input.max_steps,
    cognitive: input.cognitive,
  });
  await store.save(updated);

  const structured: Record<string, unknown> = {
    twin: { id: updated.id, name: updated.name, evolution: updated.evolution },
    outcome,
  };
  const markdown = truncate(
    `${renderTwinMarkdown(updated)}\n_Last session:_ ${outcome.completed ? "completed" : "did not complete"}, score ${outcome.overall}, ${outcome.steps} steps.`,
  );
  return { markdown, structured };
}

/**
 * Explore an app and analyze its multimodal perception — icons, charts, media,
 * loading states, toasts, and text-in-images — surfacing unlabeled visuals.
 */
export async function runMultimodalScan(input: MultimodalScanInput): Promise<ToolOutput> {
  const isMock = input.url.startsWith("mock:");
  const browser = input.browser ?? (isMock ? "mock" : "playwright");
  let adapter: BrowserAdapter;
  try {
    adapter = createAdapter(browser as AdapterName, { headless: true });
  } catch (err) {
    throw new ToolInputError(
      `Could not start the "${browser}" browser backend: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let persona: Persona;
  try {
    persona = getPersona(input.persona);
  } catch {
    throw new ToolInputError(`Unknown persona "${input.persona}". Call eve_list_personas.`);
  }

  const result = await new EveSession({
    adapter,
    startUrl: input.url,
    persona,
    seed: input.seed,
    maxSteps: input.max_steps,
    screenshots: browser !== "mock",
  }).run();

  const report = analyzeMultimodal(result);
  return { markdown: truncate(renderMultimodalMarkdown(report)), structured: { ...report } };
}

/** Curiosity-weighted default explorer personas (fall back to the library). */
const DEFAULT_EXPLORERS = ["curious-explorer", "power-user", "first-time-user", "impatient-user"];

/**
 * Autonomously explore an app with several curious operators and reconstruct
 * its application map: screens, navigation graph, information architecture,
 * hubs, dead-ends, and unexercised affordances.
 */
export async function runApplicationMap(input: ApplicationMapInput): Promise<ToolOutput> {
  const isMock = input.url.startsWith("mock:");
  const browser = input.browser ?? (isMock ? "mock" : "playwright");
  const pool =
    input.personas.length > 0
      ? input.personas
      : DEFAULT_EXPLORERS.filter((name) => listPersonas().some((p) => p.name === name));
  const personas = pool.length > 0 ? pool : listPersonas().map((p) => p.name);
  const base = String(input.seed ?? 1);

  const results: SessionResult[] = [];
  for (let i = 0; i < input.explorers; i += 1) {
    let adapter: BrowserAdapter;
    try {
      adapter = createAdapter(browser as AdapterName, { headless: true });
    } catch (err) {
      throw new ToolInputError(
        `Could not start the "${browser}" browser backend: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const persona = getPersona(personas[i % personas.length]!);
    results.push(
      await new EveSession({
        adapter,
        startUrl: input.url,
        persona,
        seed: `${base}#${i}`,
        maxSteps: input.max_steps,
        screenshots: false,
      }).run(),
    );
  }

  const map = buildApplicationMap(results);
  let file: string | null = null;
  if (input.output_dir) {
    file = join(input.output_dir, "application-map.md");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(input.output_dir, { recursive: true });
    await writeFile(file, renderApplicationMapMarkdown(map), "utf8");
  }

  const structured: Record<string, unknown> = { ...map, file };
  const markdown = truncate(
    renderApplicationMapMarkdown(map) + (file ? `\n\nWritten: ${file}` : ""),
  );
  return { markdown, structured };
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

/** Run the formal EVE Bench multi-dimensional benchmark platform. */
export async function runEveBenchTool(input: EveBenchInput): Promise<ToolOutput> {
  const report = await runEveBench({ seed: input.seed, maxSteps: input.max_steps });
  return { markdown: truncate(renderEveBenchMarkdown(report)), structured: { ...report } };
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
