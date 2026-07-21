import { parseArgs } from "node:util";
import { resolveConfig, loadConfigFile, type EveConfig } from "../config/config.js";
import { createAdapter } from "../browser/index.js";
import { definePersona, getPersona, listPersonas, registerPersona } from "../personas/index.js";
import { EveSession } from "../engine/session.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import { LlmCognition } from "../cognition/llmCognition.js";
import {
  AccessibilityPlugin,
  PerformancePlugin,
  LlmCriticPlugin,
  type EvePlugin,
} from "../plugins/index.js";
import { writeReports } from "../reporting/index.js";

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
  eve --help                  Show this help

Options for "run":
  --config <file>       YAML configuration file (CLI flags override it)
  --persona <name>      Persona to simulate (default: first-time-user)
  --goal <text>         Task for the operator (default: open-ended exploration)
  --browser <name>      playwright | puppeteer | selenium | mock
  --steps <n>           Max loop iterations (default 60)
  --minutes <n>         Max wall-clock minutes (default 10)
  --seed <value>        Reproducibility seed (number or string)
  --strategy <name>     curious | systematic | goal-directed
  --headed              Run the browser with a visible window
  --no-screenshots      Skip screenshot capture
  --llm                 Use the LLM-backed cognition policy (needs ANTHROPIC_API_KEY)
  --llm-critic          Enable the LLM design-critic plugin
  --out <dir>           Output directory (default .eve-output)
  --quiet               Only print the final summary

Examples:
  eve run https://myapp.example.com --persona impatient-user --goal "sign up for an account"
  eve run mock: --persona curious-explorer --steps 30
  eve run https://staging.example.com --config eve.yaml
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
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  // URLs beginning with mock: force the mock adapter for offline demos.
  if (config.url.startsWith("mock:")) config.browser = "mock";

  for (const spec of config.customPersonas ?? []) registerPersona(definePersona(spec));
  const persona = typeof config.persona === "string" ? getPersona(config.persona) : config.persona;

  const plugins: EvePlugin[] = [];
  if (config.plugins.accessibility) plugins.push(new AccessibilityPlugin());
  if (config.plugins.performance) plugins.push(new PerformancePlugin());
  if (config.plugins.llmCritic) {
    plugins.push(
      new LlmCriticPlugin(typeof config.plugins.llmCritic === "object" ? config.plugins.llmCritic : {}),
    );
  }

  const policy = config.llmCognition
    ? new LlmCognition(typeof config.llmCognition === "object" ? config.llmCognition : {})
    : new HeuristicCognition(config.explorationStrategy);

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
  });

  try {
    const result = await session.run();
    const written = await writeReports(result, config.outputDir);
    const overall = result.scores.find((s) => s.dimension === "overall")?.value ?? 0;
    const critical = result.findings.filter((f) => f.severity === "critical").length;
    const major = result.findings.filter((f) => f.severity === "major").length;

    process.stdout.write(`\n${"─".repeat(64)}\n`);
    process.stdout.write(`Overall experience score : ${overall}/100\n`);
    process.stdout.write(`Findings                 : ${critical} critical, ${major} major, ${result.findings.length - critical - major} other\n`);
    process.stdout.write(`Outcome                  : ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}\n`);
    process.stdout.write(`Steps / simulated time   : ${result.usage.steps} / ${(result.usage.durationMs / 60000).toFixed(1)} min\n`);
    process.stdout.write(`Reports                  : ${written.html}\n`);
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
