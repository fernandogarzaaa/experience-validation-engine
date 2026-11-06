import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main.js";

/** Capture what the CLI wrote, without letting it reach the test output. */
function captureStdout(): { text: () => string; restore: () => void } {
  let captured = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  });
  return { text: () => captured, restore: () => spy.mockRestore() };
}

describe("per-subcommand --help", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("eve chat --help prints the chat options instead of rejecting the flag", async () => {
    const out = captureStdout();
    try {
      const code = await main(["chat", "--help"]);
      expect(code).toBe(0);
      expect(out.text()).toContain('Options for "chat"');
      expect(out.text()).toContain("--turns");
    } finally {
      out.restore();
    }
  });

  it("eve run --help prints the run options", async () => {
    const out = captureStdout();
    try {
      const code = await main(["run", "--help"]);
      expect(code).toBe(0);
      expect(out.text()).toContain('Options for "run"');
      expect(out.text()).toContain("--success");
    } finally {
      out.restore();
    }
  });

  it("eve read -h prints the read options", async () => {
    const out = captureStdout();
    try {
      const code = await main(["read", "-h"]);
      expect(code).toBe(0);
      expect(out.text()).toContain('Options for "read"');
    } finally {
      out.restore();
    }
  });
});

describe("eve run --success", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts --success and routes the signals to the session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-success-"));
    const out = captureStdout();
    try {
      // "Acme Notes" is already on the mock landing screen, so the engine
      // retires the signal and says so — proving the flag reached the session.
      const code = await main([
        "run",
        "mock:",
        "--success",
        "Acme Notes",
        "--steps",
        "2",
        "--seed",
        "1",
        "--out",
        join(dir, "reports"),
      ]);
      expect(code).toBe(0);
      expect(out.text()).toContain("were already satisfied by the starting screen");
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
