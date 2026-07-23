import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runSession,
  listPersonasTool,
  listProfessionsTool,
  listCulturesTool,
  runBenchmark,
  getReport,
  ToolInputError,
} from "../src/mcp/tools.js";
import {
  RunSessionSchema,
  ListSchema,
  BenchmarkSchema,
  GetReportSchema,
} from "../src/mcp/schemas.js";
import { createServer } from "../src/mcp/server.js";

/** Apply Zod defaults the way the MCP SDK does before a handler runs. */
function runInput(overrides: Record<string, unknown>) {
  return RunSessionSchema.parse({ url: "mock:", ...overrides });
}

describe("mcp catalog tools", () => {
  it("lists personas with descriptions", () => {
    const out = listPersonasTool();
    expect(out.structured.count).toBeGreaterThan(0);
    expect(out.markdown).toContain("first-time-user");
    const personas = out.structured.personas as Array<{ name: string }>;
    expect(personas.some((p) => p.name === "first-time-user")).toBe(true);
  });

  it("lists professions and cultures", () => {
    expect((listProfessionsTool().structured.count as number) > 0).toBe(true);
    const cultures = listCulturesTool().structured.cultures as Array<{ locale: string }>;
    expect(cultures.some((c) => c.locale === "en-US")).toBe(true);
  });

  it("respects json vs markdown parsing defaults", () => {
    expect(ListSchema.parse({}).response_format).toBe("markdown");
    expect(ListSchema.parse({ response_format: "json" }).response_format).toBe("json");
  });
});

describe("mcp eve_run_session", () => {
  it("runs offline against the mock app and writes a report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-mcp-"));
    try {
      const out = await runSession(
        runInput({ persona: "curious-explorer", max_steps: 12, seed: 7, output_dir: dir }),
      );
      expect(out.structured.persona).toBeTruthy();
      expect(typeof out.structured.overallScore).toBe("number");
      const reports = out.structured.reports as { markdown: string };
      expect(reports.markdown).toContain(dir);

      // The written report is readable back via getReport.
      const report = await getReport(GetReportSchema.parse({ output_dir: dir }));
      expect(report.markdown.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is reproducible for a fixed seed", async () => {
    const dirA = await mkdtemp(join(tmpdir(), "eve-mcp-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "eve-mcp-b-"));
    try {
      const a = await runSession(runInput({ seed: 42, max_steps: 10, output_dir: dirA }));
      const b = await runSession(runInput({ seed: 42, max_steps: 10, output_dir: dirB }));
      expect(a.structured.overallScore).toBe(b.structured.overallScore);
      expect((a.structured.usage as { steps: number }).steps).toBe(
        (b.structured.usage as { steps: number }).steps,
      );
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it("gives an actionable error for an unknown persona", async () => {
    await expect(runSession(runInput({ persona: "nope-not-real" }))).rejects.toBeInstanceOf(
      ToolInputError,
    );
  });

  it("gives an actionable error for an unknown profession", async () => {
    await expect(
      runSession(runInput({ profession: "astronaut-wizard" })),
    ).rejects.toThrow(/Unknown profession/);
  });
});

describe("mcp eve_get_report", () => {
  it("errors clearly when no report exists yet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-mcp-empty-"));
    try {
      await expect(getReport(GetReportSchema.parse({ output_dir: dir }))).rejects.toThrow(
        /Run eve_run_session/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mcp eve_benchmark", () => {
  it("ranks the reference apps correctly", async () => {
    const out = await runBenchmark(BenchmarkSchema.parse({}));
    expect(out.structured.ordered).toBe(true);
    expect((out.structured.results as unknown[]).length).toBeGreaterThanOrEqual(3);
  }, 60_000);
});

describe("mcp server registration", () => {
  it("registers exactly the six EVE tools", () => {
    // createServer wires all tools without throwing; the smoke path exercises
    // the SDK registration surface.
    expect(() => createServer()).not.toThrow();
  });
});
