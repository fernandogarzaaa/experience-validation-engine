import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { EveSession } from "../src/engine/session.js";
import { McpAdapter } from "../src/surface/mcp.js";
import { connectMcpInProcess } from "../src/surface/mcpClient.js";
import { LINE_HEIGHT } from "../src/surface/textFrame.js";
import { createGoodServer, createSloppyServer } from "./fixtures/mcpFixture.js";

const VIEWPORT = { width: 960, height: 540 };

function goodConnector() {
  return (target: string) => connectMcpInProcess(createGoodServer().server, target);
}

/** The 0-based frame line an interactive element sits on. */
async function lineOf(adapter: McpAdapter, text: string): Promise<number> {
  const snapshot = await adapter.snapshot();
  const el = snapshot.elements.find((e) => e.interactive && e.text.includes(text));
  expect(el, `interactive element containing "${text}"`).toBeTruthy();
  return Math.floor((el?.box.y ?? 0) / LINE_HEIGHT);
}

async function clickLine(adapter: McpAdapter, line: number): Promise<void> {
  await adapter.clickAt({ x: 4, y: line * LINE_HEIGHT + 1 });
}

describe("McpAdapter", () => {
  it("declares a textual, non-spatial surface", () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    expect(adapter.capabilities.spatial).toBe(false);
    expect(adapter.capabilities.modality).toBe("textual");
    expect(adapter.capabilities.canScreenshot).toBe(false);
  });

  it("perceives tools/list as an affordance menu", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    const snapshot = await adapter.snapshot();
    expect(snapshot.url).toBe("mcp:in-process-fixture");
    expect(snapshot.title).toBe("fixture-calculator");
    const text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("fixture-calculator");
    expect(text).toContain("Add two numbers");
    const actionable = snapshot.elements.filter((el) => el.interactive);
    expect(actionable.map((el) => el.text)).toContain("add");
    await adapter.close();
  });

  it("projects a tool call as form fill + submit, and the result as the next frame", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);

    await clickLine(adapter, await lineOf(adapter, "add"));
    let snapshot = await adapter.snapshot();
    let text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("Tool:");
    expect(text).toContain("required");
    const editable = snapshot.elements.filter((el) => el.editable);
    expect(editable.map((el) => el.text)).toEqual(["a", "b"]);

    await clickLine(adapter, await lineOf(adapter, "a"));
    await adapter.typeText("2", 0);
    await clickLine(adapter, await lineOf(adapter, "b"));
    await adapter.typeText("3", 0);
    await adapter.pressKey("Enter");

    snapshot = await adapter.snapshot();
    text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("result from add");
    expect(text).toContain("5");
    expect(snapshot.dialogs).toHaveLength(0);
    await adapter.close();
  });

  it("projects a protocol error as a dialog", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    await clickLine(adapter, await lineOf(adapter, "add"));
    await clickLine(adapter, await lineOf(adapter, "a"));
    await adapter.typeText("not-a-number", 0);
    await clickLine(adapter, await lineOf(adapter, "b"));
    await adapter.typeText("3", 0);
    await adapter.pressKey("Enter");
    const snapshot = await adapter.snapshot();
    expect(snapshot.dialogs.length).toBeGreaterThan(0);
    expect(snapshot.dialogs[0]?.text).toContain("numeric");
    const text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("error from add");
    await adapter.close();
  });

  it("never produces a screenshot and has no back button", async () => {
    const adapter = new McpAdapter({ connector: goodConnector() });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    expect(await adapter.screenshot()).toBeNull();
    await adapter.goBack(); // must be a harmless no-op
    await adapter.close();
  });

  it("refreshes the menu when the server sends tools/list_changed", async () => {
    const fixture = createGoodServer();
    const adapter = new McpAdapter({
      connector: (target) => connectMcpInProcess(fixture.server, target),
    });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    expect((await adapter.snapshot()).elements.map((el) => el.text)).not.toContain("multiply");

    await fixture.addTool({
      name: "multiply",
      description: "Multiply two numbers and return their product as text.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
    });
    // The notification is delivered asynchronously; give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    const text = (await adapter.snapshot()).elements.map((el) => el.text).join(" ");
    expect(text).toContain("multiply");
    await adapter.close();
  });

  it("runs a full persona session against an MCP server with no vision findings", async () => {
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
    expect(result.usage.steps).toBeGreaterThan(0);
    expect([
      "goal-achieved",
      "step-budget-exhausted",
      "abandoned",
      "time-budget-exhausted",
    ]).toContain(result.endReason);
    // Phase-0 honesty gate: no pixel-derived findings on a textual surface.
    expect(result.findings.filter((f) => f.category === "visual")).toHaveLength(0);
    // The operator really did reach the tool catalog.
    expect(result.iterations.some((it) => it.url.startsWith("mcp:"))).toBe(true);
  }, 30_000);

  it("presents a tool-free server as a dead end with no affordances", async () => {
    const empty = createSloppyServer();
    empty.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
    const adapter = new McpAdapter({
      connector: (target) => connectMcpInProcess(empty, target),
    });
    await adapter.open("mcp:in-process-fixture", VIEWPORT);
    const snapshot = await adapter.snapshot();
    expect(snapshot.elements.filter((el) => el.interactive)).toHaveLength(0);
    await adapter.close();
  });
});
