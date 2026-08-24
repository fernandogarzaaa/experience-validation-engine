/**
 * Zod input schemas for the EVE MCP server tools.
 *
 * These are the single source of truth for tool inputs: the server passes the
 * `.shape` of each object to `registerTool`, and the tool implementations in
 * `tools.ts` consume the inferred types.
 */

import { z } from "zod";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export enum BrowserBackend {
  MOCK = "mock",
  PLAYWRIGHT = "playwright",
  PUPPETEER = "puppeteer",
  SELENIUM = "selenium",
  MOBILE = "mobile",
}

/** `eve_run_session` — run one simulated-human session. */
export const RunSessionSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .describe(
        "Target to validate. A real URL (https://…) drives a real browser, " +
          "or `mock:` (optionally `mock:<screen>`) runs EVE's built-in offline " +
          "demo app with no browser or network required.",
      ),
    persona: z
      .string()
      .default("first-time-user")
      .describe(
        "Persona to simulate (e.g. first-time-user, impatient-user, " +
          "power-user, elderly-user, accessibility-user). Use eve_list_personas " +
          "to see the catalog.",
      ),
    goal: z
      .string()
      .optional()
      .describe(
        "The task the operator is trying to accomplish (e.g. 'sign up for an " +
          "account'). Omit for open-ended exploration.",
      ),
    goal_success_signals: z
      .array(z.string())
      .default([])
      .describe(
        "Visible text fragments that all must appear for the goal to count as " +
          "achieved (e.g. ['invitation sent']).",
      ),
    profession: z
      .string()
      .optional()
      .describe(
        "Optional professional overlay (doctor, accountant, lawyer, …) applied " +
          "to the persona. Use eve_list_professions for the catalog.",
      ),
    culture: z
      .string()
      .optional()
      .describe(
        "Optional cultural profile / locale (en-US, de-DE, ja-JP, ar-SA, …). " +
          "Use eve_list_cultures for the catalog.",
      ),
    browser: z
      .enum(BrowserBackend)
      .optional()
      .describe(
        "Browser backend. Defaults to `mock` for `mock:` URLs and `playwright` " +
          "for real URLs. Real backends must be installed as peer dependencies. " +
          "Use `mobile` to emulate a touch device (see `device`).",
      ),
    device: z
      .string()
      .optional()
      .describe(
        'Device to emulate when browser is "mobile" (default "iPhone 14"): ' +
          "iPhone 14 | iPhone SE | Pixel 7 | iPad Mini. Ignored for other backends.",
      ),
    max_steps: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(60)
      .describe("Maximum interaction steps before the session ends."),
    max_minutes: z
      .number()
      .min(0.1)
      .max(60)
      .default(10)
      .describe("Maximum simulated wall-clock minutes."),
    seed: z
      .union([z.number(), z.string()])
      .optional()
      .describe(
        "Reproducibility seed. The same (app, persona, seed) yields the same " +
          "session — always set this when comparing runs.",
      ),
    cognitive: z
      .boolean()
      .default(false)
      .describe(
        "Enable the enhanced cognitive suite: selective attention, cognitive " +
          "load, trust, and the expectation engine.",
      ),
    utility: z
      .boolean()
      .default(false)
      .describe(
        "Use utility-based decision-making (softmax over emotion-weighted " +
          "expected value) instead of the default heuristic policy.",
      ),
    remember_file: z
      .string()
      .optional()
      .describe(
        "Path to a JSON memory file. When set, the operator carries learned app " +
          "knowledge across runs — run repeatedly against the same app to see it " +
          "get faster (power law of practice).",
      ),
    output_dir: z
      .string()
      .default(".eve-output")
      .describe(
        "Directory to write the full report.html / report.md / report.json. " +
          "Pass the same value to eve_get_report to read the full report back.",
      ),
    screenshots: z
      .boolean()
      .default(false)
      .describe("Capture screenshots (real browsers only; ignored for mock)."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe(
        "Output format: 'markdown' for a human-readable summary or 'json' for " +
          "the full structured summary.",
      ),
  })
  .strict();

/** `eve_run_usability_study` — simulate a population and aggregate it. */
export const RunUsabilityStudySchema = z
  .object({
    url: z
      .string()
      .min(1)
      .describe(
        "Target to study. A real URL drives real browsers (one per operator), " +
          "or `mock:` runs EVE's offline demo app.",
      ),
    size: z
      .number()
      .int()
      .min(2)
      .max(200)
      .default(25)
      .describe("Number of simulated operators in the population (2–200)."),
    personas: z
      .array(z.string())
      .default([])
      .describe(
        "Persona names to sample from (round-robin). Empty = the whole " +
          "built-in library, giving a diverse population.",
      ),
    professions: z
      .array(z.string())
      .default([])
      .describe("Professional overlays to mix across the population (optional)."),
    cultures: z
      .array(z.string())
      .default([])
      .describe("Cultural profiles / locales to mix across the population (optional)."),
    goal: z
      .string()
      .optional()
      .describe("The task every operator attempts. Omit for open-ended exploration."),
    goal_success_signals: z
      .array(z.string())
      .default([])
      .describe("Visible text that all must appear for the goal to count as achieved."),
    seed: z
      .union([z.number(), z.string()])
      .optional()
      .describe("Base seed; each operator derives a distinct seed. Set for reproducibility."),
    max_steps: z.number().int().min(1).max(500).default(60).describe("Max steps per operator."),
    cognitive: z.boolean().default(false).describe("Enable the enhanced cognitive suite."),
    utility: z.boolean().default(false).describe("Use utility-based decisions."),
    browser: z
      .enum(BrowserBackend)
      .optional()
      .describe("Browser backend (defaults to mock for `mock:` URLs, else playwright)."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(4)
      .describe("How many operators to run concurrently."),
    output_dir: z
      .string()
      .optional()
      .describe(
        "If set, write the full research dataset (study.json, operators.csv, " + "study.md) here.",
      ),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' report or 'json' aggregate."),
  })
  .strict();

/** `eve_bench` — run the formal EVE Bench multi-dimensional benchmark suite. */
export const EveBenchSchema = z
  .object({
    seed: z.union([z.number(), z.string()]).optional().describe("Base seed for reproducibility."),
    max_steps: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(40)
      .describe("Max steps per benchmark session."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' scorecard or 'json'."),
  })
  .strict();

/** `eve_multimodal_scan` — perceive higher-level visual cues across an app. */
export const MultimodalScanSchema = z
  .object({
    url: z.string().min(1).describe("The app to scan, or `mock:` for the offline demo."),
    persona: z.string().default("curious-explorer").describe("Persona used to explore the app."),
    seed: z.union([z.number(), z.string()]).optional().describe("Seed for reproducibility."),
    max_steps: z.number().int().min(1).max(500).default(50).describe("Max exploration steps."),
    browser: z.enum(BrowserBackend).optional().describe("Browser backend (default inferred)."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' report or 'json'."),
  })
  .strict();

/**
 * `eve_read_artifact` — read a digital output like a human.
 *
 * The reading counterpart of `eve_run_session`: the target is something the
 * operator *receives* rather than drives (a report, a deck, an analytics
 * export, a `--help` screen, a transcript, an API payload).
 */
export const ReadArtifactSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .describe(
        "File path or http(s) URL. Standard input (`-`) is not available here — the MCP server uses stdio for the protocol itself.",
      ),
    persona: z.string().default("first-time-user").describe("The reader to simulate."),
    profession: z.string().optional().describe("Professional overlay for the reader."),
    genre: z
      .enum(["document", "presentation", "analytics", "transcript", "data", "interface"])
      .optional()
      .describe("Force the genre instead of inferring it from the content."),
    format: z
      .enum(["markdown", "slides", "html", "json", "yaml", "csv", "transcript", "text"])
      .optional()
      .describe("Force a reader instead of letting detection choose."),
    goal: z.string().optional().describe("What the reader came to find out."),
    seed: z.union([z.number(), z.string()]).optional().describe("Seed for reproducibility."),
    max_steps: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe("Max reading steps (default scales with the artifact's length)."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' reading report or 'json'."),
  })
  .strict();

/**
 * `eve_evaluate_conversation` — talk to something that answers back.
 *
 * The conversational counterpart of `eve_run_session`: the target replies
 * rather than being driven or read.
 */
export const EvaluateConversationSchema = z
  .object({
    target: z
      .string()
      .min(1)
      .describe("Chat endpoint URL, or `mock:` for the built-in offline demo bot."),
    persona: z.string().default("first-time-user").describe("Who is doing the talking."),
    profession: z.string().optional().describe("Professional overlay for the operator."),
    goal: z
      .string()
      .default("get help with my problem")
      .describe(
        "What the person came for — becomes their opening line, so phrase it as they would say it.",
      ),
    goal_success_signals: z
      .array(z.string())
      .default([])
      .describe("Words in a reply that mean they got what they came for."),
    kind: z
      .enum(["support", "assistant", "copilot", "scripted"])
      .optional()
      .describe("What is being talked to; sets what the operator expects."),
    reply_path: z
      .string()
      .optional()
      .describe(
        "Dotted path to the reply text, e.g. choices.0.message.content. Common shapes are tried by default.",
      ),
    headers: z
      .record(z.string(), z.string())
      .optional()
      .describe("Extra request headers, e.g. an authorization token."),
    body_template: z
      .string()
      .optional()
      .describe(
        'Request body template; {{message}} is substituted. Default {"message": "{{message}}"}.',
      ),
    max_turns: z.number().int().min(1).max(100).default(24).describe("Max turns before giving up."),
    seed: z.union([z.number(), z.string()]).optional().describe("Seed for reproducibility."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' conversation report or 'json'."),
  })
  .strict();

/** `eve_calibrate` — score EVE's realism against a human study. */
export const CalibrateSchema = z
  .object({
    human_file: z
      .string()
      .min(1)
      .describe("Path to a JSON file with anonymized human traces ({ task?, traces: [...] })."),
    url: z.string().min(1).describe("The same app the humans used (or `mock:`)."),
    size: z.number().int().min(2).max(200).default(30).describe("EVE operators to simulate."),
    goal: z.string().optional().describe("The task (should match the human study's task)."),
    goal_success_signals: z.array(z.string()).default([]).describe("Success signals for the goal."),
    seed: z.union([z.number(), z.string()]).optional().describe("Base seed."),
    max_steps: z.number().int().min(1).max(500).default(60).describe("Max steps per operator."),
    concurrency: z.number().int().min(1).max(16).default(4).describe("Operators run concurrently."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' report or 'json'."),
  })
  .strict();

/** `eve_twin_session` — run one session as a persistent, evolving digital twin. */
export const TwinSessionSchema = z
  .object({
    twin_file: z
      .string()
      .min(1)
      .describe("Path to the JSON file that persists this twin across sessions."),
    twin_id: z.string().min(1).describe("Stable id of the twin within the file."),
    name: z
      .string()
      .optional()
      .describe("Display name (required only when creating the twin the first time)."),
    base_persona: z
      .string()
      .optional()
      .describe("Base persona (required only when creating the twin, e.g. power-user)."),
    profession: z.string().optional().describe("Optional professional overlay (creation only)."),
    culture: z.string().optional().describe("Optional cultural profile / locale (creation only)."),
    url: z
      .string()
      .min(1)
      .describe("The app to use this session, or `mock:` for the offline demo."),
    goal: z.string().optional().describe("The task the twin attempts this session."),
    goal_success_signals: z.array(z.string()).default([]).describe("Success signals for the goal."),
    seed: z.union([z.number(), z.string()]).optional().describe("Seed for this session."),
    max_steps: z.number().int().min(1).max(500).default(60).describe("Max steps this session."),
    cognitive: z.boolean().default(false).describe("Enable the enhanced cognitive suite."),
    browser: z.enum(BrowserBackend).optional().describe("Browser backend (default inferred)."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' profile or 'json'."),
  })
  .strict();

/** `eve_application_map` — autonomously explore an app and map it. */
export const ApplicationMapSchema = z
  .object({
    url: z.string().min(1).describe("The app to explore, or `mock:` for the offline demo."),
    explorers: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3)
      .describe("Number of exploratory operators (more = broader coverage)."),
    personas: z
      .array(z.string())
      .default([])
      .describe("Persona pool for the explorers (default: a curiosity-weighted mix)."),
    seed: z.union([z.number(), z.string()]).optional().describe("Base seed for reproducibility."),
    max_steps: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe("Max exploration steps per operator."),
    browser: z.enum(BrowserBackend).optional().describe("Browser backend (default inferred)."),
    output_dir: z.string().optional().describe("If set, write application-map.md here."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' map (with a Mermaid graph) or 'json'."),
  })
  .strict();

/** `eve_compare_builds` — trend experience across an ordered series of builds. */
export const CompareBuildsSchema = z
  .object({
    builds: z
      .array(
        z.object({
          url: z.string().min(1).describe("The build's URL, or `mock:` for the offline app."),
          label: z
            .string()
            .optional()
            .describe("A label for this build (e.g. a version or commit)."),
        }),
      )
      .min(2)
      .max(10)
      .describe(
        "Ordered builds, oldest first (2–10). Each is studied with the same population config.",
      ),
    size: z.number().int().min(2).max(200).default(20).describe("Operators per build."),
    goal: z
      .string()
      .optional()
      .describe("The task every operator attempts (applied to all builds)."),
    goal_success_signals: z
      .array(z.string())
      .default([])
      .describe("Success signals (applied to all builds)."),
    seed: z
      .union([z.number(), z.string()])
      .optional()
      .describe("Base seed (shared across builds)."),
    max_steps: z.number().int().min(1).max(500).default(40).describe("Max steps per operator."),
    cognitive: z.boolean().default(false).describe("Enable the enhanced cognitive suite."),
    utility: z.boolean().default(false).describe("Use utility-based decisions."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(16)
      .default(4)
      .describe("Operators run concurrently per build."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' trend report or 'json' aggregate."),
  })
  .strict();

/** Shared shape for the catalog-listing tools. */
export const ListSchema = z
  .object({
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' (human-readable) or 'json'."),
  })
  .strict();

/** `eve_benchmark` — validate EVE against known-quality reference apps. */
export const BenchmarkSchema = z
  .object({
    cognitive: z
      .boolean()
      .default(false)
      .describe("Run the benchmark with the enhanced cognitive suite enabled."),
    response_format: z
      .nativeEnum(ResponseFormat)
      .default(ResponseFormat.MARKDOWN)
      .describe("Output format: 'markdown' (human-readable) or 'json'."),
  })
  .strict();

/** `eve_get_report` — read a previously written report back. */
export const GetReportSchema = z
  .object({
    output_dir: z
      .string()
      .default(".eve-output")
      .describe(
        "The directory a prior eve_run_session wrote to (same value as its " + "output_dir).",
      ),
    format: z
      .enum(["markdown", "json"])
      .default("markdown")
      .describe(
        "Which report file to read: 'markdown' (report.md, best for reading) or " +
          "'json' (report.json, full machine-readable data).",
      ),
  })
  .strict();

export type RunSessionInput = z.infer<typeof RunSessionSchema>;
export type RunUsabilityStudyInput = z.infer<typeof RunUsabilityStudySchema>;
export type CompareBuildsInput = z.infer<typeof CompareBuildsSchema>;
export type ApplicationMapInput = z.infer<typeof ApplicationMapSchema>;
export type TwinSessionInput = z.infer<typeof TwinSessionSchema>;
export type CalibrateInput = z.infer<typeof CalibrateSchema>;
export type MultimodalScanInput = z.infer<typeof MultimodalScanSchema>;
export type ReadArtifactInput = z.infer<typeof ReadArtifactSchema>;
export type EvaluateConversationInput = z.infer<typeof EvaluateConversationSchema>;
export type EveBenchInput = z.infer<typeof EveBenchSchema>;
export type ListInput = z.infer<typeof ListSchema>;
export type BenchmarkInput = z.infer<typeof BenchmarkSchema>;
export type GetReportInput = z.infer<typeof GetReportSchema>;
