import { describe, expect, it } from "vitest";
import { findingCategoryRegistry } from "../src/core/findingCategories.js";
import {
  checkToolSchemas,
  evaluateMcpServer,
  fuzzTools,
  renderMcpEvalMarkdown,
} from "../src/mcpEval/index.js";
import { actionVerbRegistry } from "../src/protocol/verbs.js";
import { dimensionRegistry } from "../src/scoring/dimensions.js";
import { connectMcpInProcess } from "../src/surface/mcpClient.js";
import {
  createFragileServer,
  createGoodServer,
  createSloppyServer,
} from "./fixtures/mcpFixture.js";

function connectorFor(
  makeServer: () => import("@modelcontextprotocol/sdk/server/index.js").Server,
) {
  return (target: string) => connectMcpInProcess(makeServer(), target);
}

const goodServerConnector = connectorFor(() => createGoodServer().server);

describe("checkToolSchemas (pure oracle)", () => {
  it("flags a dangling required entry as major", () => {
    const findings = checkToolSchemas([
      {
        name: "broken",
        description: "A tool whose schema contradicts itself in the required list.",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q", "ghost"],
        },
      },
    ]);
    const dangling = findings.find((f) => f.title.includes("does not declare"));
    expect(dangling?.severity).toBe("major");
    expect(dangling?.evidence.some((e) => e.includes("ghost"))).toBe(true);
  });

  it("flags missing and thin descriptions", () => {
    const findings = checkToolSchemas([
      { name: "silent", inputSchema: { type: "object", properties: {} } },
      {
        name: "terse",
        description: "short",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    expect(findings.some((f) => f.title === '"silent" has no description')).toBe(true);
    expect(findings.some((f) => f.title.includes("too thin"))).toBe(true);
  });

  it("flags annotation/name mismatches", () => {
    const findings = checkToolSchemas([
      {
        name: "delete_records",
        description: "Permanently deletes every record matching the filter.",
        inputSchema: { type: "object", properties: {} },
        annotations: { destructiveHint: false },
      },
      {
        name: "get_status",
        description: "Read the current status of the deployment pipeline.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: false },
      },
    ]);
    expect(findings.some((f) => f.title.includes("sounds destructive"))).toBe(true);
    expect(findings.some((f) => f.title.includes("sounds read-only"))).toBe(true);
  });

  it("flags non-object schemas and duplicate names", () => {
    const tool = {
      name: "dup",
      description: "A perfectly ordinary description of an ordinary tool.",
      inputSchema: { type: "string" },
    };
    const findings = checkToolSchemas([tool, tool]);
    expect(findings.some((f) => f.title.includes("not an object schema"))).toBe(true);
    expect(findings.some((f) => f.title.includes('Duplicate tool name "dup"'))).toBe(true);
  });

  it("passes a well-described tool with honest annotations", () => {
    const findings = checkToolSchemas([
      {
        name: "add",
        description: "Add two numbers and return their sum as text.",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "First addend" },
            b: { type: "number", description: "Second addend" },
          },
          required: ["a", "b"],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
    ]);
    expect(findings.filter((f) => f.severity === "major" || f.severity === "critical")).toEqual([]);
  });
});

describe("evaluateMcpServer", () => {
  it("registers the mcp.* vocabulary via the Phase-0 registries", async () => {
    await evaluateMcpServer("fixture", { connector: goodServerConnector, fuzz: false });
    expect(dimensionRegistry.has("mcp.schemaQuality")).toBe(true);
    expect(dimensionRegistry.has("mcp.robustness")).toBe(true);
    expect(dimensionRegistry.has("mcp.conformance")).toBe(true);
    expect(dimensionRegistry.require("mcp.robustness").appliesTo).toEqual(["textual"]);
    expect(findingCategoryRegistry.has("mcp.robustness")).toBe(true);
    const verb = actionVerbRegistry.require("mcp.invoke");
    expect(verb.onCp1Wire).toBe(false);
    expect(verb.builtin).toBe(false);
  });

  it("scores a well-behaved server at 100 across dimensions", async () => {
    const report = await evaluateMcpServer("fixture", {
      connector: goodServerConnector,
      fuzz: { timeoutMs: 2_000, seed: 3 },
    });
    expect(report.server).toEqual({ name: "fixture-calculator", version: "1.0.0" });
    expect(report.toolCount).toBe(1);
    expect(report.listChanged).toBe(true);
    for (const score of report.scores) {
      expect(score.value, `${score.dimension} should be 100`).toBe(100);
    }
    expect(report.fuzz?.crashes).toBe(0);
    expect(report.fuzz?.acceptedInvalid).toBe(0);
    expect(report.findings.filter((f) => f.severity !== "info")).toEqual([]);
  });

  it("reports schema, conformance and robustness findings on a sloppy server", async () => {
    const report = await evaluateMcpServer("fixture", {
      connector: connectorFor(createSloppyServer),
      fuzz: { timeoutMs: 2_000, seed: 5 },
    });
    const titles = report.findings.map((f) => f.title).join("\n");
    // schema oracle
    expect(titles).toContain("does not declare");
    expect(titles).toContain("has no description");
    expect(titles).toContain("sounds destructive");
    expect(titles).toContain("sounds read-only");
    // conformance oracle: the sloppy server answers unknown tools with success
    expect(titles).toContain("nonexistent tool succeeded");
    // fuzz oracle: `lax` accepts garbage
    expect(titles).toContain("accepted clearly-invalid arguments");
    // scores reflect the findings, each with evidence
    const robustness = report.scores.find((s) => s.dimension === "mcp.robustness");
    expect(robustness?.value).toBeLessThan(100);
    expect(robustness && robustness.evidence.length > 0).toBe(true);
    const schema = report.scores.find((s) => s.dimension === "mcp.schemaQuality");
    expect(schema?.value).toBeLessThan(80);
    expect(report.fuzz && report.fuzz.acceptedInvalid > 0).toBe(true);
  });

  it("classifies a mid-call crash as critical and stops fuzzing", async () => {
    const report = await evaluateMcpServer("fixture", {
      connector: connectorFor(createFragileServer),
      fuzz: { timeoutMs: 500, perTool: 2, seed: 9 },
    });
    const crash = report.findings.find((f) => f.title.includes("crashed the server"));
    expect(crash?.severity).toBe("critical");
    expect(crash?.category).toBe("mcp.robustness");
    expect(report.fuzz?.crashes).toBe(1);
    const robustness = report.scores.find((s) => s.dimension === "mcp.robustness");
    expect(robustness && robustness.value <= 75).toBe(true);
  });

  it("classifies an unanswered call as a hang", async () => {
    const conn = await connectMcpInProcess(createFragileServer(), "fixture");
    const result = await fuzzTools(
      conn,
      [
        {
          name: "slow",
          description: "Never respond, whatever the arguments are.",
          inputSchema: { type: "object", properties: { x: { type: "string" } } },
        },
      ],
      { timeoutMs: 300, perTool: 1, seed: 4 },
    );
    expect(result.stats.hangs).toBe(1);
    expect(result.findings.some((f) => f.title.includes("did not answer"))).toBe(true);
    await conn.close().catch(() => {});
  });

  it("renders a markdown report", async () => {
    const report = await evaluateMcpServer("fixture", {
      connector: connectorFor(createSloppyServer),
      fuzz: false,
    });
    const md = renderMcpEvalMarkdown(report);
    expect(md).toContain("# MCP evaluation");
    expect(md).toContain("mcp.schemaQuality");
    expect(md).toContain("## Findings");
  });

  it("keeps vocabulary registration idempotent across runs", async () => {
    await evaluateMcpServer("fixture", { connector: goodServerConnector, fuzz: false });
    await evaluateMcpServer("fixture", { connector: goodServerConnector, fuzz: false });
    // Duplicate registration would have thrown inside EveRegistry.register.
    expect(dimensionRegistry.list().filter((d) => d.id.startsWith("mcp."))).toHaveLength(3);
  });
});
