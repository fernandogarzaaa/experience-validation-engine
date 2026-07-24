#!/usr/bin/env node
/**
 * Protocol-level smoke test for the EVE MCP server.
 *
 * Spawns `bin/eve-mcp.js`, performs the MCP initialize handshake, lists the
 * tools, and asserts the expected six EVE tools are advertised. Exits non-zero
 * on any mismatch so CI catches a broken stdio server that unit tests (which
 * import the tool functions directly) would miss. Requires `npm run build`.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED = [
  "eve_run_session",
  "eve_run_usability_study",
  "eve_run_user_study",
  "eve_product_report",
  "eve_compare_builds",
  "eve_application_map",
  "eve_predict_ux",
  "eve_twin_session",
  "eve_calibrate",
  "eve_list_personas",
  "eve_list_professions",
  "eve_list_cultures",
  "eve_benchmark",
  "eve_get_report",
];

const child = spawn("node", [join(root, "bin", "eve-mcp.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buffer = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function fail(reason) {
  console.error(`MCP smoke test failed: ${reason}`);
  child.kill();
  process.exit(1);
}

const timeout = setTimeout(() => fail("timed out waiting for the server"), 15000);

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-smoke", version: "0" },
  });
  if (init.result?.serverInfo?.name !== "eve-mcp-server") {
    fail(`unexpected server name: ${init.result?.serverInfo?.name}`);
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const list = await request(2, "tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name).sort();
  const missing = EXPECTED.filter((name) => !names.includes(name));
  if (missing.length) fail(`missing tools: ${missing.join(", ")}`);

  clearTimeout(timeout);
  console.log(`MCP smoke test passed — ${names.length} tools: ${names.join(", ")}`);
  child.kill();
  process.exit(0);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
