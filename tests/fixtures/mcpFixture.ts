/**
 * In-process MCP fixture servers for the Phase-1 adapter/oracle tests.
 *
 * Built on the SDK's low-level `Server` (not the high-level `McpServer` EVE
 * itself uses) because the fixtures must be able to misbehave in ways the
 * high-level API prevents: dangling `required` entries, missing
 * descriptions, accepting garbage, crashing mid-call.
 *
 * Servers are connected to the evaluator through `connectMcpInProcess`
 * (`src/surface/mcpClient.ts`) over `InMemoryTransport` — no subprocesses.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

type ToolSpec = Record<string, unknown>;

/** A well-behaved calculator server: valid schemas, honest annotations,
 * protocol-error rejection of bad input, live list_changed notifications. */
export function createGoodServer(): {
  server: Server;
  addTool: (spec: ToolSpec) => Promise<void>;
} {
  const tools: ToolSpec[] = [
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ];

  const server = new Server(
    { name: "fixture-calculator", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    if (name !== "add") {
      throw new McpError(ErrorCode.InvalidParams, `unknown tool "${name}"`);
    }
    const a = (args as Record<string, unknown> | undefined)?.a;
    const b = (args as Record<string, unknown> | undefined)?.b;
    if (typeof a !== "number" || typeof b !== "number") {
      throw new McpError(ErrorCode.InvalidParams, "add expects numeric a and b");
    }
    return { content: [{ type: "text" as const, text: String(a + b) }] };
  });

  return {
    server,
    addTool: async (spec) => {
      tools.push(spec);
      await server.sendToolListChanged();
    },
  };
}

/** A sloppy server: dangling required field, missing descriptions,
 * misleading annotations, and one tool that accepts anything. */
export function createSloppyServer(): Server {
  const server = new Server(
    { name: "fixture-sloppy", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "no_desc",
        inputSchema: {
          type: "object",
          properties: { q: { type: "string" } },
          required: ["q", "missing_field"],
        },
      },
      {
        name: "get_thing",
        description: "get thing",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        annotations: { readOnlyHint: false },
      },
      {
        name: "delete_everything",
        description: "Deletes every record in the store, permanently and immediately.",
        inputSchema: { type: "object", properties: {} },
        annotations: { destructiveHint: false },
      },
      {
        name: "lax",
        description: "A tool that happily accepts whatever it is given, valid or not.",
        inputSchema: {
          type: "object",
          properties: { n: { type: "integer", description: "A positive count" } },
          required: ["n"],
        },
        annotations: { readOnlyHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    // Never validates: garbage in, success out.
    return {
      content: [{ type: "text" as const, text: `ok: ${request.params.name}` }],
    };
  });

  return server;
}

/** A fragile server: `boom` kills the transport mid-call; `slow` never answers. */
export function createFragileServer(): Server {
  const server = new Server(
    { name: "fixture-fragile", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "boom",
        description: "Crash the server process, whatever the arguments are.",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
        annotations: { readOnlyHint: true },
      },
      {
        name: "slow",
        description: "Never respond, whatever the arguments are.",
        inputSchema: { type: "object", properties: { x: { type: "string" } } },
        annotations: { readOnlyHint: true },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "boom") {
      // Die underneath the in-flight call.
      await server.close();
    }
    if (request.params.name === "slow") {
      return new Promise<never>(() => {});
    }
    return { content: [{ type: "text" as const, text: "ok" }] };
  });

  return server;
}

/**
 * A chatty server: one tool whose result is far longer than the deprecated
 * web view's glance window, so Phase-2 tests can pin the kernel's explicit
 * truncation semantics (full text in the signal, `truncated: true`).
 */
export function createVerboseServer(lineCount = 40): Server {
  const server = new Server(
    { name: "fixture-verbose", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "report",
        description: "Return a long multi-line report.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [
      {
        type: "text" as const,
        text: Array.from({ length: lineCount }, (_, i) => `line ${i + 1} of the report`).join("\n"),
      },
    ],
  }));

  return server;
}
