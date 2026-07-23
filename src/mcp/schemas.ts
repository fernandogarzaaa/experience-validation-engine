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
      .nativeEnum(BrowserBackend)
      .optional()
      .describe(
        "Browser backend. Defaults to `mock` for `mock:` URLs and `playwright` " +
          "for real URLs. Real backends must be installed as peer dependencies.",
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
        "The directory a prior eve_run_session wrote to (same value as its " +
          "output_dir).",
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
export type ListInput = z.infer<typeof ListSchema>;
export type BenchmarkInput = z.infer<typeof BenchmarkSchema>;
export type GetReportInput = z.infer<typeof GetReportSchema>;
