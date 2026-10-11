import { afterEach, describe, expect, it, vi } from "vitest";
import { main, mcpHelpText } from "../src/mcp/server.js";

/** Capture what the server wrote to stdout, without letting it escape. */
function captureStdout(): { text: () => string; restore: () => void } {
  let captured = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  });
  return { text: () => captured, restore: () => spy.mockRestore() };
}

describe("eve-mcp --help", () => {
  const origArgv = process.argv;

  afterEach(() => {
    process.argv = origArgv;
    vi.restoreAllMocks();
  });

  it("prints usage and exits instead of starting the stdio transport", async () => {
    process.argv = ["node", "eve-mcp", "--help"];
    const out = captureStdout();
    try {
      // Must resolve promptly: the pre-fix behavior waited on stdin forever.
      await main();
      expect(out.text()).toContain("eve-mcp");
      expect(out.text()).toContain("eve_run_session");
    } finally {
      out.restore();
    }
  });

  it("answers -h the same way", async () => {
    process.argv = ["node", "eve-mcp", "-h"];
    const out = captureStdout();
    try {
      await main();
      expect(out.text()).toContain("Usage:");
    } finally {
      out.restore();
    }
  });

  it("mcpHelpText names the registered tools", () => {
    const text = mcpHelpText();
    for (const tool of [
      "eve_run_session",
      "eve_read_artifact",
      "eve_list_personas",
      "eve_bench",
      "eve_get_report",
    ]) {
      expect(text).toContain(tool);
    }
  });
});
