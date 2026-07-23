import { parseArgs } from "node:util";
import { resolveConfig, loadConfigFile, type EveConfig } from "../config/config.js";
import { createAdapter } from "../browser/index.js";
import {
  definePersona,
  getPersona,
  listPersonas,
  registerPersona,
  listProfessions,
  getProfession,
  applyProfession,
  listCultures,
  getCulture,
  type Persona,
} from "../personas/index.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import { UtilityCognition } from "../cognition/utilityCognition.js";
import { LlmCognition } from "../cognition/llmCognition.js";
import {
  AccessibilityPlugin,
  PerformancePlugin,
  LlmCriticPlugin,
  LocalizationPlugin,
  type EvePlugin,
} from "../plugins/index.js";
import { writeReports } from "../reporting/index.js";
import { FileMemoryStore } from "../memory/longTerm.js";
import { validateBenchmarks } from "../benchmarks/index.js";
import { runPanel } from "../panel/index.js";

/**
 * The `eve` CLI.
 *
 *   eve run <url> [--config eve.yaml] [--persona name] [--goal "..."] ...
 *   eve personas
 *   eve --help
 */

const HELP = `eve — Experience Validation Engine ("AI that experiences software like a human")

Usage:
  eve run <url> [options]     Run a simulated-human session against a URL
  eve personas                List built-in personas
  eve professions             List professional overlays
  eve cultures                List cultural profiles
  eve benchmark               Validate EVE against known-quality benchmark apps
  eve --help                  Show this help

Options for "run":
  --config <file>       YAML configuration file (CLI flags override it)
  --persona <name>      Persona to simulate (default: first-time-user)
  --profession <name>   Professional overlay (doctor, accountant, lawyer, ...)
  --culture <locale>    Cultural profile (en-US, de-DE, ja-JP, ar-SA, ...)
  --goal <text>         Task for the operator (default: open-ended exploration)
  --browser <name>      playwright | puppeteer | selenium | mock
  --steps <n>           Max loop iterations (default 60)
  --minutes <n>         Max wall-clock minutes (default 10)
  --seed <value>        Reproducibility seed (number or string)
  --strategy <name>     curious | systematic | goal-directed
  --cognitive           Enable the enhanced cognitive suite (attention, trust,
                        cognitive load, expectation engine)
  --utility             Use utility-based decision-making
  --remember <file>     Persist cross-session memory to a JSON file (learns
                        across runs against the same app)
  --headed              Run the browser with a visible window
  --no-screenshots      Skip screenshot capture
  --llm                 Use the LLM-backed cognition policy (needs ANTHROPIC_API_KEY)
  --llm-critic          Enable the LLM design-critic plugin
  --panel               After the run, generate the full AI-panel report
                        (design critic, forecast, moderator, PM, dev tickets)
  --out <dir>           Output directory (default .eve-output)
  --quiet               Only print the final summary

Examples:
  eve run https://myapp.example.com --persona impatient-user --goal "sign up for an account"
  eve run mock: --persona curious-explorer --cognitive --utility
  eve run mock: --persona office-worker --profession accountant --culture de-DE
  eve run mock: --remember .eve-memory.json --seed 1   # run repeatedly to see learning
`;

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (command === "personas") {
    for (const persona of listPersonas()) {
      process.stdout.write(`${persona.name.padEnd(22)} ${persona.description}\n`);
    }
    return 0;
  }

  if (command === "professions") {
    for (const p of listProfessions()) {
      process.stdout.write(`${p.name.padEnd(14)} ${p.description}\n`);
    }
    return 0;
  }

  if (command === "cultures") {
    for (const c of listCultures()) {
      process.stdout.write(`${c.locale.padEnd(8)} ${c.name} (${c.readingDirection.toUpperCase()}, ${c.currency}, ${c.dateFormat})\n`);
    }
    return 0;
  }

  if (command === "benchmark") {
    process.stdout.write("Validating EVE against known-quality benchmark apps...\n\n");
    const cognitive = rest.includes("--cognitive");
    const validation = await validateBenchmarks({ cognitive });
    for (const r of validation.results) {
      process.stdout.write(`  ${r.tier.padEnd(10)} mean score ${r.meanScore}/100\n`);
    }
    process.stdout.write(`\n${validation.summary}\n`);
    return validation.ordered ? 0 : 1;
  }

  if (command !== "run") {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      config: { type: "string" },
      persona: { type: "string" },
      goal: { type: "string" },
      browser: { type: "string" },
      steps: { type: "string" },
      minutes: { type: "string" },
      seed: { type: "string" },
      strategy: { type: "string" },
      headed: { type: "boolean" },
      "no-screenshots": { type: "boolean" },
      llm: { type: "boolean" },
      "llm-critic": { type: "boolean" },
      out: { type: "string" },
      quiet: { type: "boolean" },
      cognitive: { type: "boolean" },
      utility: { type: "boolean" },
      culture: { type: "string" },
      profession: { type: "string" },
      remember: { type: "string" },
      panel: { type: "boolean" },
    },
  });

  const url = positionals[0];
  let config: EveConfig;
  try {
    if (values.config) {
      config = await loadConfigFile(values.config);
      if (url) config.url = url;
    } else {
      if (!url) {
        process.stderr.write(`"eve run" needs a URL (or --config with a url).\n`);
        return 2;
      }
      config = resolveConfig({ url });
    }

    if (values.persona) config.persona = values.persona;
    if (values.goal) config.goal = values.goal;
    if (values.browser) config = resolveConfig({ ...configToRaw(config), browser: values.browser });
    if (values.steps) config.maxSteps = parsePositiveInt(values.steps, "--steps");
    if (values.minutes) config.maxDurationMinutes = parsePositiveInt(values.minutes, "--minutes");
    if (values.seed) config.seed = /^\d+$/.test(values.seed) ? Number(values.seed) : values.seed;
    if (values.strategy) {
      config = resolveConfig({ ...configToRaw(config), explorationStrategy: values.strategy });
    }
    if (values.headed) config.headless = false;
    if (values["no-screenshots"]) config.screenshots = false;
    if (values.llm) config.llmCognition = true;
    if (values["llm-critic"]) config.plugins.llmCritic = true;
    if (values.out) config.outputDir = values.out;
    if (values.quiet) config.verbosity = "quiet";
    if (values.cognitive) config.cognitive = true;
    if (values.utility) config.utilityDecisions = true;
    if (values.culture) config.culture = getCulture(values.culture).locale;
    if (values.profession) config.profession = getProfession(values.profession).name;
    if (values.remember) config.longTermMemoryPath = values.remember;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // URLs beginning with mock: force the mock adapter for offline demos.
  if (config.url.startsWith("mock:")) config.browser = "mock";

  for (const spec of config.customPersonas ?? []) registerPersona(definePersona(spec));
  let persona: Persona = typeof config.persona === "string" ? getPersona(config.persona) : config.persona;
  if (config.profession) persona = applyProfession(persona, getProfession(config.profession));

  const plugins: EvePlugin[] = [];
  if (config.plugins.accessibility) plugins.push(new AccessibilityPlugin());
  if (config.plugins.performance) plugins.push(new PerformancePlugin());
  if (config.culture) plugins.push(new LocalizationPlugin());
  if (config.plugins.llmCritic) {
    plugins.push(
      new LlmCriticPlugin(typeof config.plugins.llmCritic === "object" ? config.plugins.llmCritic : {}),
    );
  }

  const policy = config.llmCognition
    ? new LlmCognition(typeof config.llmCognition === "object" ? config.llmCognition : {})
    : config.utilityDecisions
      ? new UtilityCognition(config.explorationStrategy)
      : new HeuristicCognition(config.explorationStrategy);
  const longTermMemory = config.longTermMemoryPath ? new FileMemoryStore(config.longTermMemoryPath) : undefined;

  const log = (line: string) => {
    if (config.verbosity !== "quiet") process.stdout.write(`  ${line}\n`);
  };

  process.stdout.write(
    `\nEVE — simulating "${persona.name}" on ${config.url} (${config.browser}, seed ${config.seed ?? "auto"})\n\n`,
  );

  const session = new EveSession({
    adapter: createAdapter(config.browser, { headless: config.headless }),
    startUrl: config.url,
    persona,
    policy,
    plugins,
    goal: config.goal,
    goalSuccessSignals: config.goalSuccessSignals,
    seed: config.seed,
    maxSteps: config.maxSteps,
    maxDurationMs: config.maxDurationMinutes * 60 * 1000,
    viewport: config.viewport,
    screenshots: config.screenshots && config.browser !== "mock",
    paceScale: config.paceScale,
    onLog: log,
    cognitive: config.cognitive,
    culture: config.culture,
    longTermMemory,
  });

  try {
    const result: SessionResult = await session.run();
    const written = await writeReports(result, config.outputDir);
    const overall = result.scores.find((s) => s.dimension === "overall")?.value ?? 0;
    const critical = result.findings.filter((f) => f.severity === "critical").length;
    const major = result.findings.filter((f) => f.severity === "major").length;

    process.stdout.write(`\n${"─".repeat(64)}\n`);
    process.stdout.write(`Overall experience score : ${overall}/100\n`);
    process.stdout.write(`Findings                 : ${critical} critical, ${major} major, ${result.findings.length - critical - major} other\n`);
    process.stdout.write(`Outcome                  : ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}\n`);
    process.stdout.write(`Steps / simulated time   : ${result.usage.steps} / ${(result.usage.durationMs / 60000).toFixed(1)} min\n`);
    if (result.learningMetrics && result.learningMetrics.sessions > 1) {
      process.stdout.write(`Learning (this app)      : session ${result.learningMetrics.sessions}, learning rate ${result.learningMetrics.learningRate}, steps ${result.learningMetrics.stepsSeries.join("→")}\n`);
    }
    if (result.cognitiveLoad) {
      process.stdout.write(`Cognitive load index     : mean ${result.cognitiveLoad.meanIndex}, peak ${result.cognitiveLoad.peakIndex}\n`);
    }
    process.stdout.write(`Reports                  : ${written.html}\n`);

    if (values.panel) {
      const panel = runPanel([result]);
      process.stdout.write(`\nAI panel:\n`);
      process.stdout.write(`  Design critic  : ${panel.critique.inspectionScore}/100 (${panel.critique.items.length} issues)\n`);
      process.stdout.write(`  Forecast       : ${panel.forecast.summary}\n`);
      process.stdout.write(`  Product plan   : ${panel.plan.epics.length} epics, ${panel.tickets.length} tickets\n`);
    }
    process.stdout.write(`${"─".repeat(64)}\n`);
    return critical > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(`\nEVE session failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
}

/** Serialize the parts of a config that resolveConfig re-validates. */
function configToRaw(config: EveConfig): Record<string, unknown> {
  return {
    url: config.url,
    persona: typeof config.persona === "string" ? config.persona : undefined,
    browser: config.browser,
    headless: config.headless,
    viewport: config.viewport,
    goal: config.goal,
    goalSuccessSignals: config.goalSuccessSignals,
    seed: config.seed,
    maxSteps: config.maxSteps,
    maxDurationMinutes: config.maxDurationMinutes,
    explorationStrategy: config.explorationStrategy,
    screenshots: config.screenshots,
    paceScale: config.paceScale,
    outputDir: config.outputDir,
    verbosity: config.verbosity,
  };
}
