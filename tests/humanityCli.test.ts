import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli/main.js";

const REPORT = [
  "# Onboarding",
  "",
  "Welcome. This page explains how to get started.",
  "",
  "## Install",
  "",
  "Please run the installer, then sign in.",
].join("\n");

/** Capture what the CLI wrote, without letting it reach the test output. */
function captureStdout(): { text: () => string; restore: () => void } {
  let captured = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  });
  return { text: () => captured, restore: () => spy.mockRestore() };
}

describe("eve read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a file and prints the reading summary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-read-"));
    const file = join(dir, "onboarding.md");
    const out = captureStdout();
    try {
      await writeFile(file, REPORT, "utf8");
      const code = await main(["read", file, "--seed", "3", "--out", join(dir, "reports")]);
      expect(code).toBe(0);
      expect(out.text()).toContain("Understood");
      expect(out.text()).toContain("Reading ease");
      expect(out.text()).toContain("document, 2 section(s)");
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("writes the reading report when asked for one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-read-"));
    const file = join(dir, "onboarding.md");
    const reportPath = join(dir, "reading.md");
    const out = captureStdout();
    try {
      await writeFile(file, REPORT, "utf8");
      await main([
        "read",
        file,
        "--seed",
        "3",
        "--out",
        join(dir, "reports"),
        "--report",
        reportPath,
      ]);
      const markdown = await readFile(reportPath, "utf8");
      expect(markdown).toContain("# Reading report — Onboarding");
      expect(markdown).toContain("## Reading map");
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("creates the report's parent directory rather than failing the read", async () => {
    // `--report .eve-output/reading.md` on a fresh checkout names a directory
    // that does not exist yet: the read has already succeeded by then, so
    // failing here would throw the whole run away.
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-read-"));
    const file = join(dir, "onboarding.md");
    const reportPath = join(dir, "fresh", "nested", "reading.md");
    const out = captureStdout();
    try {
      await writeFile(file, REPORT, "utf8");
      const code = await main([
        "read",
        file,
        "--seed",
        "3",
        "--out",
        join(dir, "reports"),
        "--report",
        reportPath,
      ]);
      expect(code).toBe(0);
      expect(await readFile(reportPath, "utf8")).toContain("# Reading report");
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("prints the analysis as JSON on --json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-read-"));
    const file = join(dir, "onboarding.md");
    const out = captureStdout();
    try {
      await writeFile(file, REPORT, "utf8");
      await main(["read", file, "--seed", "3", "--json"]);
      const analysis = JSON.parse(out.text());
      expect(analysis.genre).toBe("document");
      expect(analysis.comprehensionScore).toBeGreaterThan(0);
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("routes a doc: target from `eve run` to the reader", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-cli-read-"));
    const file = join(dir, "onboarding.md");
    const out = captureStdout();
    try {
      await writeFile(file, REPORT, "utf8");
      const code = await main(["run", `doc:${file}`, "--seed", "3", "--json"]);
      expect(code).toBe(0);
      expect(JSON.parse(out.text()).genre).toBe("document");
    } finally {
      out.restore();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("needs a target", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await main(["read"])).toBe(2);
    } finally {
      stderr.mockRestore();
    }
  });

  it("rejects an unknown persona by name", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = captureStdout();
    try {
      expect(await main(["read", "-", "--persona", "nobody"])).toBe(2);
    } finally {
      out.restore();
      stderr.mockRestore();
    }
  });

  it("lists eve read in its own help", async () => {
    const out = captureStdout();
    try {
      await main(["--help"]);
      expect(out.text()).toContain("eve read <target>");
    } finally {
      out.restore();
    }
  });
});
