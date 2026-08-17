/**
 * Phase 2: the kernel-native MCP surface.
 *
 * These tests pin what the Phase-1 projection could not express (the
 * projection debt ledger, items 1–6): one `tools/call` is one `mcp.invoke`
 * action with typed arguments; the catalog is structured with stable
 * identity across `list_changed`; results, protocol errors, notifications
 * and termination are distinct typed signals; and the deprecated web view
 * keeps working unchanged for pre-kernel consumers.
 */

import { describe, expect, it } from "vitest";
import type { SurfaceSignal } from "../src/core/kernel.js";
import { EveSession } from "../src/engine/session.js";
import { McpAdapter } from "../src/surface/mcp.js";
import { connectMcpInProcess } from "../src/surface/mcpClient.js";
import { createGoodServer, createVerboseServer } from "./fixtures/mcpFixture.js";

const VIEWPORT = { width: 960, height: 540 };

function goodConnector() {
  return (target: string) => connectMcpInProcess(createGoodServer().server, target);
}

function signalOf<T extends SurfaceSignal["type"]>(
  signals: readonly SurfaceSignal[],
  type: T,
): Extract<SurfaceSignal, { type: T }> | undefined {
  return signals.find((s): s is Extract<SurfaceSignal, { type: T }> => s.type === type);
}

describe("McpAdapter kernel surface (Phase 2)", () => {
  it("declares its native verb registry in capabilities", () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    expect(adapter.capabilities.actionVerbs).toContain("mcp.invoke");
  });

  it("perceives the catalog as structured affordances with schema metadata", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    const kernel = await adapter.kernelPercept();
    expect(kernel.modality).toBe("textual");
    expect(kernel.frame.address).toBe("mcp:in-process-fixture");
    expect(kernel.frame.label).toBe("fixture-calculator");

    const add = kernel.affordances.find((a) => a.id === "tool:add");
    expect(add).toBeDefined();
    expect(add?.kind).toBe("mcp.tool");
    expect(add?.locator).toEqual({ kind: "schemaPath", path: "/tools/add" });
    expect(add?.description).toContain("Add two numbers");
    // Annotations are perceived metadata now — no longer dropped (ledger 2).
    const metadata = add?.state.metadata as {
      inputSchema?: { properties?: Record<string, unknown> };
      annotations?: { readOnlyHint?: boolean };
    };
    expect(metadata.inputSchema?.properties).toHaveProperty("a");
    expect(metadata.annotations?.readOnlyHint).toBe(true);
    await adapter.close();
  });

  it("keeps affordance identity stable across tools/list_changed", async () => {
    const fixture = createGoodServer();
    const adapter = new McpAdapter({
      connector: (target) => connectMcpInProcess(fixture.server, target),
    });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    const before = await adapter.kernelPercept();
    expect(before.affordances.map((a) => a.id)).toEqual(["tool:add"]);

    await fixture.addTool({
      name: "multiply",
      description: "Multiply two numbers.",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
    });
    await new Promise((r) => setTimeout(r, 50));

    const after = await adapter.kernelPercept();
    // Positional identity is gone: the existing tool keeps its id, the new
    // one joins it, and the change itself is a typed notification signal.
    expect(after.affordances.map((a) => a.id)).toEqual(["tool:add", "tool:multiply"]);
    expect(signalOf(after.signals, "notification")?.method).toBe(
      "notifications/tools/list_changed",
    );
    await adapter.close();
  });

  it("executes one mcp.invoke as one tools/call with typed arguments", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);

    await adapter.actKernel({
      verb: "mcp.invoke",
      payload: { tool: "add", arguments: { a: 2, b: 3 } },
    });

    const kernel = await adapter.kernelPercept();
    const result = signalOf(kernel.signals, "tool-result");
    expect(result).toMatchObject({ tool: "add", isError: false, text: "5", truncated: false });
    expect(kernel.frame.surfaceState).toBe("result");
    await adapter.close();
  });

  it("distinguishes protocol errors from tool results as typed signals", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);

    // The fixture server rejects non-numeric args at protocol level.
    await adapter.actKernel({
      verb: "mcp.invoke",
      payload: { tool: "add", arguments: { a: "not-a-number", b: 3 } },
    });

    const kernel = await adapter.kernelPercept();
    const error = signalOf(kernel.signals, "error");
    expect(error?.source).toBe("protocol");
    expect(error?.text).toContain("numeric");
    expect(signalOf(kernel.signals, "tool-result")).toBeUndefined();

    // The deprecated web view still projects it as a fake dialog, unchanged.
    const legacy = await adapter.snapshot();
    expect(legacy.dialogs.length).toBeGreaterThan(0);
    await adapter.close();
  });

  it("carries full result text in the kernel and reports web-view truncation", async () => {
    const adapter = new McpAdapter({
      connector: (target) => connectMcpInProcess(createVerboseServer(40), target),
    });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    await adapter.actKernel({ verb: "mcp.invoke", payload: { tool: "report", arguments: {} } });

    const kernel = await adapter.kernelPercept();
    const result = signalOf(kernel.signals, "tool-result");
    // No silent loss (ledger 3): all forty lines, truncation made explicit.
    expect(result?.text).toContain("line 40 of the report");
    expect(result?.truncated).toBe(true);

    // …while the deprecated web view is the truncated one.
    const legacy = await adapter.snapshot();
    const text = legacy.elements.map((el) => el.text).join(" ");
    expect(text).not.toContain("line 40 of the report");
    await adapter.close();
  });

  it("rejects verbs outside its declared registry", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    await expect(adapter.actKernel({ verb: "click" })).rejects.toThrow("click");
    await adapter.close();
  });
});

describe("native MCP persona session (Phase 2)", () => {
  it("calls a tool in a single mcp.invoke action with typed arguments", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    const session = new EveSession({
      adapter,
      startUrl: "mcp:in-process-fixture",
      persona: "curious-explorer",
      goal: "add two numbers",
      maxSteps: 12,
      seed: 11,
      screenshots: false,
      paceScale: 0,
      viewport: VIEWPORT,
    });
    const result = await session.run();

    // One semantic act — never form fill + Enter (ledger 1).
    const invoke = result.iterations.find((it) => it.action.kind === "invoke");
    expect(invoke).toBeDefined();
    if (invoke?.action.kind !== "invoke") throw new Error("unreachable");
    expect(invoke.action.verb).toBe("mcp.invoke");
    expect(invoke.actionDescription).toMatch(/^invoke add\(/);

    // Typed arguments: numbers, not text (ledger 4).
    const payload = invoke.action.payload as { tool: string; arguments: Record<string, unknown> };
    expect(payload.tool).toBe("add");
    expect(typeof payload.arguments.a).toBe("number");
    expect(typeof payload.arguments.b).toBe("number");

    // The call visibly produced a result the operator then perceived.
    expect(invoke.outcome?.screenChanged).toBe(true);
  }, 30_000);

  it("gates visual-only dimensions off textual sessions", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    const session = new EveSession({
      adapter,
      startUrl: "mcp:in-process-fixture",
      persona: "curious-explorer",
      goal: "add two numbers",
      maxSteps: 8,
      seed: 11,
      screenshots: false,
      paceScale: 0,
      viewport: VIEWPORT,
    });
    const result = await session.run();
    // Skipped, not vacuously passed (Phase-0 appliesTo, wired in Phase 2).
    expect(result.scores.some((s) => s.dimension === "visualDesign")).toBe(false);
    expect(result.scores.some((s) => s.dimension === "overall")).toBe(true);
    expect(result.findings.filter((f) => f.category === "visual")).toHaveLength(0);
  }, 30_000);
});
