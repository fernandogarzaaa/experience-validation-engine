/**
 * MCP client connector — the transport layer for evaluating MCP servers.
 *
 * EVE *is* an MCP server (`src/mcp/`), so the official SDK is already a
 * runtime dependency; this module uses its client half to connect to a
 * *target* server. Two transports are supported:
 *
 * - stdio (`node server.js --flag`, the must-have): the target is spawned as
 *   a subprocess, exactly how MCP hosts launch servers.
 * - Streamable HTTP (`http://` / `https://` URLs): for servers that are
 *   already running.
 *
 * Everything here is a *client of the subject under evaluation* — it is the
 * evaluation equivalent of the browser driver, not a privileged channel.
 * The {@link McpConnection} interface is deliberately narrow so tests can
 * substitute an in-process fixture server over `InMemoryTransport` without
 * spawning anything.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type CallToolResult,
  CallToolResultSchema,
  type Implementation,
  McpError,
  type ServerCapabilities,
  type Tool,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { tokenizeCommand } from "./cli.js";

/** How a tool call ended, flattened to what an operator could perceive. */
export interface McpCallOutcome {
  /** The server answered with a tool-level error result (`isError: true`). */
  readonly isError: boolean;
  /** Concatenated text content — what a user of the tool would read. */
  readonly text: string;
  /** Structured content, when the tool returned any. */
  readonly structured?: unknown;
}

/**
 * A live connection to the MCP server under evaluation. Narrow on purpose:
 * adapters and oracles need tools/list, tools/call, ping and close — nothing
 * else. Tests implement this against an in-process fixture server.
 */
export interface McpConnection {
  /** The target string the connection was opened for (for reporting). */
  readonly target: string;
  /** Server identity from the initialize handshake, once connected. */
  readonly serverInfo: Implementation | undefined;
  /** Capabilities the server declared at initialize. */
  readonly serverCapabilities: ServerCapabilities | undefined;
  /** True after the transport has closed (server exit, crash, kill). */
  readonly closed: boolean;
  listTools(): Promise<readonly Tool[]>;
  /**
   * Call a tool. Tool-level failures come back as `isError` outcomes;
   * protocol-level failures (invalid params, unknown method, timeout,
   * connection loss) reject — the oracles classify on that distinction.
   */
  callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<McpCallOutcome>;
  /** Subscribe to `notifications/tools/list_changed`. */
  onToolsChanged(handler: () => void): void;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** A function that opens a connection to a target. Injectable for tests. */
export type McpConnector = (target: string) => Promise<McpConnection>;

const CLIENT_INFO: Implementation = { name: "eve-mcp-evaluator", version: "0.1.0" };
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

/** {@link McpConnection} over the official SDK client. */
class SdkMcpConnection implements McpConnection {
  private readonly client: Client;
  private isClosed = false;

  private constructor(
    readonly target: string,
    transport: Transport,
  ) {
    this.client = new Client(CLIENT_INFO, { capabilities: {} });
    this.client.onclose = () => {
      this.isClosed = true;
    };
    // connect() runs the initialize handshake; a target that never answers
    // rejects here, which callers surface as a setup failure (the operator
    // never reached a surface), not a UX finding.
    this.connectPromise = this.client.connect(transport);
  }

  private readonly connectPromise: Promise<void>;

  static async open(target: string, transport: Transport): Promise<SdkMcpConnection> {
    const conn = new SdkMcpConnection(target, transport);
    await conn.connectPromise;
    return conn;
  }

  get serverInfo(): Implementation | undefined {
    return this.client.getServerVersion();
  }

  get serverCapabilities(): ServerCapabilities | undefined {
    return this.client.getServerCapabilities();
  }

  get closed(): boolean {
    return this.isClosed;
  }

  async listTools(): Promise<readonly Tool[]> {
    const result = await this.client.listTools();
    return result.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  ): Promise<McpCallOutcome> {
    const result = await this.client.callTool({ name, arguments: args }, CallToolResultSchema, {
      timeout: timeoutMs,
    });
    return flattenResult(result as CallToolResult);
  }

  onToolsChanged(handler: () => void): void {
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      handler();
    });
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.isClosed = true;
    }
  }
}

/** Reduce a tool result to what an operator could actually read. */
function flattenResult(result: CallToolResult): McpCallOutcome {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text") parts.push(block.text);
    else parts.push(`[${block.type} content]`);
  }
  const structured = (result as { structuredContent?: unknown }).structuredContent;
  return {
    isError: result.isError === true,
    text: parts.join("\n"),
    ...(structured !== undefined ? { structured } : {}),
  };
}

/**
 * Connect to an MCP server target.
 *
 * Target forms (after any `mcp:` scheme prefix has been stripped):
 * - `http://…` / `https://…` → Streamable HTTP transport
 * - anything else → a command line spawned over stdio
 */
export async function connectMcpServer(target: string): Promise<McpConnection> {
  if (/^https?:\/\//.test(target)) {
    return SdkMcpConnection.open(target, new StreamableHTTPClientTransport(new URL(target)));
  }
  const [command, ...args] = tokenizeCommand(target);
  if (!command) throw new Error(`empty MCP target command in "${target}"`);
  return SdkMcpConnection.open(
    target,
    new StdioClientTransport({
      command,
      args,
      // The server's stderr is its diagnostics channel, not protocol; inherit
      // it so a crashing target stays debuggable.
      stderr: "inherit",
    }),
  );
}

/**
 * Connect to an MCP server running in the same process (an SDK `Server`
 * instance). This is how tests evaluate fixture servers without spawning
 * anything — and how EVE can evaluate *itself* (`createServer()` from
 * `src/mcp/server.ts`) as the ultimate dogfood.
 */
export async function connectMcpInProcess(
  server: Server,
  target = "in-process",
): Promise<McpConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return SdkMcpConnection.open(target, clientTransport);
}

/** JSON-RPC error codes the evaluators classify on. */
export { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

/** Is this error the transport dying underneath a call (a server crash)? */
export function isConnectionClosedError(error: unknown): boolean {
  return error instanceof McpError && error.message.includes("Connection closed");
}

/** Is this error the client giving up on an unanswered request (a hang)? */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof McpError && error.message.includes("timed out");
}
