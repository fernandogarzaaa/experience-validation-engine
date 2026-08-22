import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BenchmarkSchema,
  GetReportSchema,
  ListSchema,
  ReadArtifactSchema,
  RunSessionSchema,
} from "../src/mcp/schemas.js";
import { createServer } from "../src/mcp/server.js";
import {
  getReport,
  listCulturesTool,
  listPersonasTool,
  listProfessionsTool,
  runBenchmark,
  runReadArtifact,
  runSession,
  ToolInputError,
} from "../src/mcp/tools.js";

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
    await expect(runSession(runInput({ profession: "astronaut-wizard" }))).rejects.toThrow(
      /Unknown profession/,
    );
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

describe("mcp eve_read_artifact", () => {
  // Two separators, each followed by a heading: the shape that tells a
  // reader (and the reader registry) this is a deck rather than a document.
  const DECK = [
    "# Platform Strategy",
    "",
    "Our plan for the year.",
    "",
    "---",
    "",
    "## Results",
    "",
    "Revenue grew.",
    "",
    "---",
    "",
    "## Risks",
    "",
    "It might not work.",
  ].join("\n");

  it("reads an artifact from disk and reports what the reader understood", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-read-"));
    const file = join(dir, "deck.md");
    try {
      await writeFile(file, DECK, "utf8");
      const out = await runReadArtifact(ReadArtifactSchema.parse({ target: file, seed: 3 }));
      const artifact = out.structured.artifact as Record<string, unknown>;
      expect(artifact.genre).toBe("presentation");
      expect(artifact.sections).toBe(3);
      expect(out.markdown).toContain("Reading report");
      const comprehension = out.structured.comprehension as { comprehensionScore: number };
      expect(comprehension.comprehensionScore).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports an unreadable target as an input error, not a crash", async () => {
    await expect(
      runReadArtifact(ReadArtifactSchema.parse({ target: "/no/such/artifact.md" })),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("rejects an unknown persona by name", async () => {
    await expect(
      runReadArtifact(ReadArtifactSchema.parse({ target: "x.md", persona: "nobody" })),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("refuses to read standard input, which is the protocol transport here", async () => {
    // The shipped server speaks JSON-RPC over stdio, so consuming stdin would
    // hang the call or corrupt the stream. The CLI keeps `-`; this tool cannot.
    await expect(runReadArtifact(ReadArtifactSchema.parse({ target: "-" }))).rejects.toThrow(
      /cannot read standard input/i,
    );
  });
});

describe("mcp server registration", () => {
  it("registers the EVE tools without throwing", () => {
    // createServer wires all tools without throwing; the protocol-level smoke
    // test (scripts/mcp-smoke.mjs) asserts the exact advertised tool set.
    expect(() => createServer()).not.toThrow();
  });
});
