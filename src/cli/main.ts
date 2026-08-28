import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { validateBenchmarks } from "../benchmarks/index.js";
import {
  createAdapter,
  diagnoseSurfaces,
  isOptionalTransport,
  renderDoctor,
} from "../browser/index.js";
import { HeuristicCognition } from "../cognition/heuristicCognition.js";
import { LlmCognition } from "../cognition/llmCognition.js";
import { UtilityCognition } from "../cognition/utilityCognition.js";
import { type EveConfig, loadConfigFile, resolveConfig } from "../config/config.js";
import {
  converse,
  DEMO_SUPPORT_BOT,
  HttpBackend,
  renderConversationMarkdown,
  ScriptedBackend,
} from "../conversation/index.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import {
  artifactWordCount,
  DOC_SCHEME,
  docTargetOf,
  readArtifact,
  renderComprehensionMarkdown,
} from "../humanity/index.js";
import { evaluateMcpServer, renderMcpEvalMarkdown } from "../mcpEval/index.js";
import { FileMemoryStore } from "../memory/longTerm.js";
import { runPanel } from "../panel/index.js";
import {
  applyProfession,
  definePersona,
  getCulture,
  getPersona,
  getProfession,
  listCultures,
  listPersonas,
  listProfessions,
  type Persona,
  registerPersona,
} from "../personas/index.js";
import {
  AccessibilityPlugin,
  type EvePlugin,
  LlmCriticPlugin,
  LocalizationPlugin,
  PerformancePlugin,
} from "../plugins/index.js";
import { simulatePopulation } from "../population/index.js";
import { inferProductIntelligence, renderProductIntelligenceMarkdown } from "../product/index.js";
import { writeReports } from "../reporting/index.js";
import { renderStudyMarkdown, writeStudyDataset } from "../research/index.js";
import { moderateStudy, renderModeratedStudyMarkdown } from "../study/index.js";
import { McpAdapter } from "../surface/mcp.js";

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
  eve chat <target> [options] Talk to something that answers back (a support
                              bot, an LLM copilot, a voice assistant). Use
                              "mock:" for the built-in offline demo bot.
  eve read <target> [options] Read a digital output like a human (documents,
                              decks, analytics, transcripts, payloads, help
                              screens). Use "-" to read standard input.
  eve study <url> [options]   Run a population usability study (many operators)
  eve mcp-eval <target>       Evaluate an MCP server (schema, conformance, fuzzing)
  eve personas                List built-in personas
  eve professions             List professional overlays
  eve cultures                List cultural profiles
  eve benchmark               Validate EVE against known-quality benchmark apps
  eve doctor                  Check which surfaces are usable on this machine
  eve --help                  Show this help

Options for "run":
  --config <file>       YAML configuration file (CLI flags override it)
  --persona <name>      Persona to simulate (default: first-time-user)
  --profession <name>   Professional overlay (doctor, accountant, lawyer, ...)
  --culture <locale>    Cultural profile (en-US, de-DE, ja-JP, ar-SA, ...)
  --goal <text>         Task for the operator (default: open-ended exploration)
  --browser <name>      playwright | puppeteer | selenium | mobile | mock
  --device <name>       Device to emulate when --browser mobile (default
                        "iPhone 14"): iPhone 14 | iPhone SE | Pixel 7 | iPad Mini
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

Options for "study" (population usability study):
  --size <n>            Number of simulated operators (default 25)
  --personas <a,b,c>    Persona pool to sample (default: whole library)
  --professions <a,b>   Professional overlays to mix (comma-separated)
  --cultures <a,b>      Cultural profiles to mix (comma-separated)
  --goal <text>         Task every operator attempts
  --seed <value>        Base reproducibility seed
  --steps <n>           Max steps per operator (default 60)
  --cognitive           Enable the enhanced cognitive suite
  --utility             Use utility-based decision-making
  --concurrency <n>     Operators to run in parallel (default 4)
  --out <dir>           Write the research dataset here (study.json/csv/md)
  --format <fmt>        Console output: markdown | json (default markdown)
  --panel               Convene the AI-moderated study panel (6 specialists +
                        moderator) and append an executive report with a verdict
  --product             Append inferred product intelligence (personas,
                        workflows, business goals, friction, drop-off causes)
  --quiet               Suppress per-operator progress

Examples:
  eve run https://myapp.example.com --persona impatient-user --goal "sign up for an account"
  eve run mock: --persona curious-explorer --cognitive --utility
  eve run mock: --persona office-worker --profession accountant --culture de-DE
  eve run mock: --remember .eve-memory.json --seed 1   # run repeatedly to see learning
  eve run "mcp:node my-server.js" --goal "look up a customer"   # operate an MCP server
  eve study mock: --size 50 --seed 7 --out .eve-output/study
  eve study https://myapp.example.com --goal "sign up" --professions accountant,designer
  eve mcp-eval "node my-server.js"           # deterministic MCP server evaluation
  eve mcp-eval "node my-server.js" --no-fuzz # schema + conformance only
  eve read ./docs/quarterly-report.md --persona elderly-user
  eve read ./deck.md --genre presentation --persona impatient-user
  eve read ./metrics.csv --goal "did signups grow"
  git log --oneline | eve read - --genre transcript
  eve read https://example.com/changelog.html --report .eve-output/reading.md
  eve chat mock: --goal "get a refund for being charged twice"
  eve chat https://api.example.com/chat --goal "reset my password" --success "sent,email"
  eve chat https://api.example.com/v1/chat --reply-path choices.0.message.content \\
    --header "authorization: Bearer $TOKEN" --persona impatient-user

Options for "read":
  --persona <name>      Reader to simulate (default: first-time-user)
  --profession <name>   Professional overlay (doctor, accountant, lawyer, ...)
  --genre <name>        document | presentation | analytics | transcript |
                        data | interface (default: inferred from content)
  --format <fmt>        Force a reader: markdown | slides | html | json | yaml |
                        csv | transcript | text (default: detected)
  --goal <text>         What the reader came to find out
  --seed <value>        Reproducibility seed
  --steps <n>           Max reading steps (default: scales with length)
  --out <dir>           Write session reports here (default .eve-output)
  --report <file>       Also write the reading report as Markdown
  --json                Print the comprehension analysis as JSON
  --quiet               Only print the final summary

Options for "chat":
  --persona <name>      Who is doing the talking (default: first-time-user)
  --profession <name>   Professional overlay (doctor, accountant, lawyer, ...)
  --goal <text>         What they came for — becomes their opening line
  --success <a,b>       Words that mean they got it (comma-separated)
  --kind <name>         support | assistant | copilot | scripted
  --turns <n>           Max turns before giving up (default 24)
  --seed <value>        Reproducibility seed
  --reply-path <path>   Where the reply lives in the response JSON, e.g.
                        choices.0.message.content (default: common shapes)
  --header <k:v>        Extra request header (repeatable)
  --body <json>         Request body template; {{message}} is substituted
  --out <dir>           Write session reports here (default .eve-output)
  --report <file>       Also write the conversation report as Markdown
  --json                Print the conversation analysis as JSON
  --quiet               Only print the final summary

Options for "mcp-eval":
  --no-fuzz             Skip robustness fuzzing (schema + conformance only)
  --format <fmt>        markdown | json (default markdown)
  --seed <value>        Reproducibility seed for fuzz case selection
  --timeout <ms>        Per-call timeout for fuzz probes (default 5000)
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
      process.stdout.write(
        `${c.locale.padEnd(8)} ${c.name} (${c.readingDirection.toUpperCase()}, ${c.currency}, ${c.dateFormat})\n`,
      );
    }
    return 0;
  }

  if (command === "doctor") {
    const reports = await diagnoseSurfaces();
    process.stdout.write(renderDoctor(reports));
    // A missing or broken alternative transport is not a failure: Puppeteer and
    // Selenium perceive exactly what the bundled Playwright adapter perceives,
    // so their absence costs the user nothing and must not fail a CI preflight.
    // Only a broken surface that actually costs capability sets a failing code.
    return reports.some((r) => r.status === "broken" && !isOptionalTransport(r.surface)) ? 1 : 0;
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

  if (command === "study") {
    return runStudyCommand(rest);
  }

  if (command === "mcp-eval") {
    return runMcpEvalCommand(rest);
  }

  if (command === "read") {
    return runReadCommand(rest);
  }

  if (command === "chat") {
    return runChatCommand(rest);
  }

  // `doc:` routes a target at the humanity seam, so a document can sit
  // wherever a URL does — a config file, a CI matrix, a benchmark list —
  // without the caller having to know which command reads it. `eve read` is
  // the ergonomic form of the same thing.
  if (command === "run") {
    const docTarget = rest.find((arg) => arg.startsWith(DOC_SCHEME));
    if (docTarget) {
      return runReadCommand(rest.map((arg) => (arg === docTarget ? docTargetOf(docTarget) : arg)));
    }
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
      device: { type: "string" },
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
    if (values.device) config.device = values.device;
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
  let persona: Persona =
    typeof config.persona === "string" ? getPersona(config.persona) : config.persona;
  if (config.profession) persona = applyProfession(persona, getProfession(config.profession));

  const plugins: EvePlugin[] = [];
  if (config.plugins.accessibility) plugins.push(new AccessibilityPlugin());
  if (config.plugins.performance) plugins.push(new PerformancePlugin());
  if (config.culture) plugins.push(new LocalizationPlugin());
  if (config.plugins.llmCritic) {
    plugins.push(
      new LlmCriticPlugin(
        typeof config.plugins.llmCritic === "object" ? config.plugins.llmCritic : {},
      ),
    );
  }

  const policy = config.llmCognition
    ? new LlmCognition(typeof config.llmCognition === "object" ? config.llmCognition : {})
    : config.utilityDecisions
      ? new UtilityCognition(config.explorationStrategy)
      : new HeuristicCognition(config.explorationStrategy);
  const longTermMemory = config.longTermMemoryPath
    ? new FileMemoryStore(config.longTermMemoryPath)
    : undefined;

  const log = (line: string) => {
    if (config.verbosity !== "quiet") process.stdout.write(`  ${line}\n`);
  };

  process.stdout.write(
    `\nEVE — simulating "${persona.name}" on ${config.url} (${config.url.startsWith("mcp:") ? "mcp" : config.browser}, seed ${config.seed ?? "auto"})\n\n`,
  );

  const isMcp = config.url.startsWith("mcp:");
  const session = new EveSession({
    // mcp: URLs project an MCP server onto the textual-surface seam.
    adapter: isMcp
      ? new McpAdapter()
      : createAdapter(config.browser, { headless: config.headless, device: config.device }),
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
    screenshots: config.screenshots && config.browser !== "mock" && !isMcp,
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
    process.stdout.write(
      `Findings                 : ${critical} critical, ${major} major, ${result.findings.length - critical - major} other\n`,
    );
    process.stdout.write(
      `Outcome                  : ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}\n`,
    );
    process.stdout.write(
      `Steps / simulated time   : ${result.usage.steps} / ${(result.usage.durationMs / 60000).toFixed(1)} min\n`,
    );
    if (result.learningMetrics && result.learningMetrics.sessions > 1) {
      process.stdout.write(
        `Learning (this app)      : session ${result.learningMetrics.sessions}, learning rate ${result.learningMetrics.learningRate}, steps ${result.learningMetrics.stepsSeries.join("→")}\n`,
      );
    }
    if (result.cognitiveLoad) {
      process.stdout.write(
        `Cognitive load index     : mean ${result.cognitiveLoad.meanIndex}, peak ${result.cognitiveLoad.peakIndex}\n`,
      );
    }
    process.stdout.write(`Reports                  : ${written.html}\n`);

    if (values.panel) {
      const panel = runPanel([result]);
      process.stdout.write("\nAI panel:\n");
      process.stdout.write(
        `  Design critic  : ${panel.critique.inspectionScore}/100 (${panel.critique.items.length} issues)\n`,
      );
      process.stdout.write(`  Forecast       : ${panel.forecast.summary}\n`);
      process.stdout.write(
        `  Product plan   : ${panel.plan.epics.length} epics, ${panel.tickets.length} tickets\n`,
      );
    }
    process.stdout.write(`${"─".repeat(64)}\n`);
    return critical > 0 ? 1 : 0;
  } catch (err) {
    process.stderr.write(
      `\nEVE session failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
}

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** `eve study` — run a population usability study and report the aggregate. */
async function runStudyCommand(rest: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      size: { type: "string" },
      personas: { type: "string" },
      professions: { type: "string" },
      cultures: { type: "string" },
      goal: { type: "string" },
      seed: { type: "string" },
      steps: { type: "string" },
      cognitive: { type: "boolean" },
      utility: { type: "boolean" },
      concurrency: { type: "string" },
      out: { type: "string" },
      format: { type: "string" },
      panel: { type: "boolean" },
      product: { type: "boolean" },
      quiet: { type: "boolean" },
    },
  });

  const url = positionals[0];
  if (!url) {
    process.stderr.write(`"eve study" needs a URL (or mock:).\n`);
    return 2;
  }
  const format = values.format ?? "markdown";
  if (format !== "markdown" && format !== "json") {
    process.stderr.write(`--format must be "markdown" or "json".\n`);
    return 2;
  }

  try {
    const study = await simulatePopulation({
      url,
      size: values.size ? parsePositiveInt(values.size, "--size") : undefined,
      personas: splitList(values.personas),
      professions: splitList(values.professions),
      cultures: splitList(values.cultures),
      goal: values.goal,
      seed: values.seed
        ? /^\d+$/.test(values.seed)
          ? Number(values.seed)
          : values.seed
        : undefined,
      maxSteps: values.steps ? parsePositiveInt(values.steps, "--steps") : undefined,
      cognitive: Boolean(values.cognitive),
      utility: Boolean(values.utility),
      concurrency: values.concurrency
        ? parsePositiveInt(values.concurrency, "--concurrency")
        : undefined,
      onProgress: values.quiet
        ? undefined
        : (done, total) => {
            if (done === total || done % 10 === 0)
              process.stderr.write(`  ${done}/${total} operators\n`);
          },
    });

    const report = values.panel ? moderateStudy(study) : null;
    const intel = values.product ? inferProductIntelligence(study) : null;
    const base = values.out ? values.out.replace(/\/$/, "") : null;

    if (base) {
      const written = await writeStudyDataset(study, base);
      process.stderr.write(
        `\nDataset written: ${written.markdown} · ${written.csv} · ${written.json}\n`,
      );
      if (report) {
        await writeFile(`${base}/moderated-study.md`, renderModeratedStudyMarkdown(report), "utf8");
        process.stderr.write(`Moderated study: ${base}/moderated-study.md\n`);
      }
      if (intel) {
        await writeFile(
          `${base}/product-report.md`,
          renderProductIntelligenceMarkdown(intel),
          "utf8",
        );
        process.stderr.write(`Product report: ${base}/product-report.md\n`);
      }
    }

    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify(
          { study, ...(report ? { moderated: report } : {}), ...(intel ? { product: intel } : {}) },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stdout.write(`${renderStudyMarkdown(study)}\n`);
      if (report) process.stdout.write(`\n${renderModeratedStudyMarkdown(report)}\n`);
      if (intel) process.stdout.write(`\n${renderProductIntelligenceMarkdown(intel)}\n`);
    }
    // Non-zero exit if most of the population fails — CI-gate friendly.
    return study.successRate < 0.5 ? 1 : 0;
  } catch (err) {
    process.stderr.write(
      `\nEVE study failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/** Serialize the parts of a config that resolveConfig re-validates. */ function configToRaw(
  config: EveConfig,
): Record<string, unknown> {
  return {
    url: config.url,
    persona: typeof config.persona === "string" ? config.persona : undefined,
    browser: config.browser,
    device: config.device,
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

/** `eve mcp-eval` — deterministic MCP server evaluation (schema + conformance + fuzzing). */
async function runMcpEvalCommand(rest: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...rest],
    allowPositionals: true,
    options: {
      "no-fuzz": { type: "boolean" },
      format: { type: "string" },
      seed: { type: "string" },
      timeout: { type: "string" },
    },
  });

  const target = positionals.join(" ");
  if (!target) {
    process.stderr.write(`"eve mcp-eval" needs a target, e.g. eve mcp-eval "node my-server.js".\n`);
    return 2;
  }
  const format = values.format ?? "markdown";
  if (format !== "markdown" && format !== "json") {
    process.stderr.write(`--format must be "markdown" or "json".\n`);
    return 2;
  }

  try {
    const report = await evaluateMcpServer(target, {
      fuzz: values["no-fuzz"]
        ? false
        : {
            ...(values.seed
              ? { seed: /^\d+$/.test(values.seed) ? Number(values.seed) : values.seed }
              : {}),
            ...(values.timeout ? { timeoutMs: parsePositiveInt(values.timeout, "--timeout") } : {}),
          },
    });
    process.stdout.write(
      format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMcpEvalMarkdown(report),
    );
    // CI-gate friendly: any critical finding (e.g. a fuzz crash) fails the run.
    return report.findings.some((f) => f.severity === "critical") ? 1 : 0;
  } catch (err) {
    process.stderr.write(
      `\nEVE mcp-eval failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/**
 * `eve read <target>` — put a reader in front of a digital output.
 *
 * The reading counterpart of `eve run`: same personas, same session loop,
 * same evidence-backed reports, but the operator reads rather than clicks.
 * The console output is the reading experience in the order a person would
 * describe it — what they understood, how long it took, and where they lost
 * the thread — with the full findings in the written reports.
 */
async function runReadCommand(rest: readonly string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      options: {
        persona: { type: "string" },
        profession: { type: "string" },
        genre: { type: "string" },
        format: { type: "string" },
        goal: { type: "string" },
        seed: { type: "string" },
        steps: { type: "string" },
        out: { type: "string" },
        report: { type: "string" },
        json: { type: "boolean" },
        quiet: { type: "boolean" },
      },
    });
    values = parsed.values as Record<string, string | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const target = positionals[0];
  if (!target) {
    process.stderr.write(`"eve read" needs a file, a URL, or "-" for standard input.\n`);
    return 2;
  }

  let persona: Persona;
  try {
    persona = getPersona(typeof values.persona === "string" ? values.persona : "first-time-user");
    if (typeof values.profession === "string") {
      persona = applyProfession(persona, getProfession(values.profession));
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const quiet = values.quiet === true;
  const asJson = values.json === true;
  const log = (line: string) => {
    if (!quiet && !asJson) process.stdout.write(`  ${line}\n`);
  };

  if (!quiet && !asJson) {
    process.stdout.write(`\nEVE — "${persona.name}" reading ${target}\n\n`);
  }

  try {
    const result = await readArtifact(target, {
      persona,
      ...(typeof values.genre === "string" ? { genre: values.genre as never } : {}),
      ...(typeof values.format === "string" ? { format: values.format as never } : {}),
      ...(typeof values.goal === "string" ? { goal: values.goal } : {}),
      ...(typeof values.seed === "string"
        ? { seed: /^\d+$/.test(values.seed) ? Number(values.seed) : values.seed }
        : {}),
      ...(typeof values.steps === "string"
        ? { maxSteps: parsePositiveInt(values.steps, "--steps") }
        : {}),
      onLog: log,
    });

    if (asJson) {
      process.stdout.write(`${JSON.stringify(result.comprehension, null, 2)}\n`);
      return exitCodeFor(result.findings);
    }

    const markdown = renderComprehensionMarkdown(result.comprehension, result.artifact);
    if (typeof values.report === "string") {
      // The reading report can land anywhere, including inside an output
      // directory that `writeReports` has not created yet — the documented
      // `--report .eve-output/reading.md` on a fresh checkout is exactly that
      // case. Failing here would throw away a read that already succeeded.
      await mkdir(dirname(values.report), { recursive: true });
      await writeFile(values.report, markdown, "utf8");
    }

    const written = await writeReports(
      result,
      typeof values.out === "string" ? values.out : ".eve-output",
    );
    const critical = result.findings.filter((f) => f.severity === "critical").length;
    const major = result.findings.filter((f) => f.severity === "major").length;
    const artifact = result.artifact;
    const noun = artifact.sections[0]?.noun ?? "section";

    process.stdout.write(`\n${"─".repeat(64)}\n`);
    process.stdout.write(
      `Artifact                 : ${artifact.genre}, ${artifact.sections.length} ${noun}(s), ${artifactWordCount(artifact)} words (${artifact.format})\n`,
    );
    process.stdout.write(
      `Understood               : ${result.comprehension.comprehensionScore}/100\n`,
    );
    process.stdout.write(
      `Reading ease             : Flesch ${result.comprehension.readability.fleschReadingEase} (grade ${result.comprehension.readability.gradeLevel})\n`,
    );
    process.stdout.write(
      `Reading time             : ${(result.comprehension.readingTimeMs / 60000).toFixed(1)} min at this reader's pace\n`,
    );
    process.stdout.write(
      `Findings                 : ${critical} critical, ${major} major, ${result.findings.length - critical - major} other\n`,
    );
    process.stdout.write(
      `Outcome                  : ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}\n`,
    );
    process.stdout.write(`Reports                  : ${written.html}\n`);
    if (typeof values.report === "string") {
      process.stdout.write(`Reading report           : ${values.report}\n`);
    }
    process.stdout.write("\n");

    return exitCodeFor(result.findings);
  } catch (err) {
    process.stderr.write(
      `\nEVE read failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/** A critical finding fails the run, so `eve read` works as a CI gate. */
function exitCodeFor(findings: readonly { severity: string }[]): number {
  return findings.some((f) => f.severity === "critical") ? 1 : 0;
}

/**
 * `eve chat <target>` — put a person in front of something that answers back.
 *
 * The conversational counterpart of `eve run` and `eve read`: same personas,
 * same session loop, same evidence-backed reports, but the operator talks and
 * the surface talks back. `mock:` is the built-in demo bot, so the seam can
 * be demonstrated with no network and no API key.
 */
async function runChatCommand(rest: readonly string[]): Promise<number> {
  let values: Record<string, string | string[] | boolean | undefined>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      options: {
        persona: { type: "string" },
        profession: { type: "string" },
        goal: { type: "string" },
        success: { type: "string" },
        kind: { type: "string" },
        turns: { type: "string" },
        seed: { type: "string" },
        "reply-path": { type: "string" },
        header: { type: "string", multiple: true },
        body: { type: "string" },
        out: { type: "string" },
        report: { type: "string" },
        json: { type: "boolean" },
        quiet: { type: "boolean" },
      },
    });
    values = parsed.values as Record<string, string | string[] | boolean | undefined>;
    positionals = parsed.positionals;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const target = positionals[0];
  if (!target) {
    process.stderr.write(`"eve chat" needs a chat endpoint URL, or "mock:" for the demo bot.\n`);
    return 2;
  }

  let persona: Persona;
  try {
    persona = getPersona(typeof values.persona === "string" ? values.persona : "first-time-user");
    if (typeof values.profession === "string") {
      persona = applyProfession(persona, getProfession(values.profession));
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  const quiet = values.quiet === true;
  const asJson = values.json === true;
  const log = (line: string) => {
    if (!quiet && !asJson) process.stdout.write(`  ${line}\n`);
  };

  // An unrecognized kind is not cosmetic: it silently un-gates the checks
  // that only run for a support conversation, so a typo turns "no route to a
  // person" from a critical finding into a major one and drops the turn
  // budget rule — quietly making a red CI run green.
  const kinds = ["support", "assistant", "copilot", "scripted"] as const;
  if (typeof values.kind === "string" && !kinds.includes(values.kind as (typeof kinds)[number])) {
    process.stderr.write(`--kind must be one of ${kinds.join(", ")}; got "${values.kind}".\n`);
    return 2;
  }

  const isMock = target === "mock:" || target.startsWith("mock:");
  if (!isMock && !/^https?:\/\//i.test(target)) {
    process.stderr.write(
      `"eve chat" needs an http(s) chat endpoint, or "mock:" for the offline demo; got "${target}".\n`,
    );
    return 2;
  }
  const backend = isMock
    ? new ScriptedBackend(DEMO_SUPPORT_BOT)
    : new HttpBackend({
        url: target,
        ...(typeof values["reply-path"] === "string" ? { replyPath: values["reply-path"] } : {}),
        ...(typeof values.body === "string" ? { bodyTemplate: values.body } : {}),
        ...(Array.isArray(values.header) ? { headers: parseHeaders(values.header) } : {}),
      });

  const goal = typeof values.goal === "string" ? values.goal : "get help with my problem";

  if (!quiet && !asJson) {
    process.stdout.write(`\nEVE — "${persona.name}" talking to ${target}\n\n`);
  }

  try {
    const result = await converse(backend, {
      persona,
      goal,
      address: isMock ? "chat:mock:" : `chat:${target}`,
      ...(typeof values.kind === "string" ? { kind: values.kind as (typeof kinds)[number] } : {}),
      ...(typeof values.success === "string"
        ? {
            goalSuccessSignals: values.success
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : {}),
      ...(typeof values.seed === "string"
        ? { seed: /^\d+$/.test(values.seed) ? Number(values.seed) : values.seed }
        : {}),
      ...(typeof values.turns === "string"
        ? { maxSteps: parsePositiveInt(values.turns, "--turns") }
        : {}),
      onLog: log,
    });

    if (asJson) {
      process.stdout.write(`${JSON.stringify(result.conversation, null, 2)}\n`);
      return exitCodeFor(result.findings);
    }

    const markdown = renderConversationMarkdown(result.conversation, result.transcript);
    if (typeof values.report === "string") {
      await mkdir(dirname(values.report), { recursive: true });
      await writeFile(values.report, markdown, "utf8");
    }

    const written = await writeReports(
      result,
      typeof values.out === "string" ? values.out : ".eve-output",
    );
    const critical = result.findings.filter((f) => f.severity === "critical").length;
    const major = result.findings.filter((f) => f.severity === "major").length;
    const c = result.conversation;

    process.stdout.write(`\n${"─".repeat(64)}\n`);
    process.stdout.write(
      `Conversation             : ${c.kind}, ${c.turnCount} turn(s), asked ${c.operatorTurns} time(s)\n`,
    );
    process.stdout.write(
      `Understood the person    : ${c.understanding}/100 (${c.silentMisses} silent miss(es), ${c.admittedMisses} admitted)\n`,
    );
    process.stdout.write(`Showed it understood     : ${c.grounding}/100\n`);
    process.stdout.write(
      `Recovered when it failed : ${c.recovery}/100 (${c.everOfferedHandoff ? "offered a person" : "never offered a person"})\n`,
    );
    process.stdout.write(`Had to rephrase          : ${c.repairAttempts}×\n`);
    if (c.meanLatencyMs !== null) {
      process.stdout.write(
        `Reply time               : mean ${(c.meanLatencyMs / 1000).toFixed(1)}s, slowest ${((c.maxLatencyMs ?? 0) / 1000).toFixed(1)}s\n`,
      );
    }
    process.stdout.write(
      `Findings                 : ${critical} critical, ${major} major, ${result.findings.length - critical - major} other\n`,
    );
    process.stdout.write(
      `Outcome                  : ${result.endReason}${result.abandonReason ? ` — ${result.abandonReason}` : ""}\n`,
    );
    process.stdout.write(`Reports                  : ${written.html}\n`);
    if (typeof values.report === "string") {
      process.stdout.write(`Conversation report      : ${values.report}\n`);
    }
    process.stdout.write("\n");

    return exitCodeFor(result.findings);
  } catch (err) {
    process.stderr.write(
      `\nEVE chat failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

/** `--header "authorization: Bearer x"` → `{ authorization: "Bearer x" }`. */
function parseHeaders(raw: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of raw) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    headers[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return headers;
}
