import { describe, expect, it, vi } from "vitest";
import { MockAdapter } from "../src/browser/index.js";
import { assertUrlAllowed, safeJoin, sanitizeFilename } from "../src/core/security.js";
import { EveSession } from "../src/engine/index.js";

describe("output path safety (P1.12)", () => {
  it("safeJoin resolves inside the output dir", () => {
    expect(safeJoin("out", "report.html").endsWith("report.html")).toBe(true);
  });

  it("safeJoin refuses traversal outside the output dir", () => {
    expect(() => safeJoin("out", "..", "evil.html")).toThrow(/outside output dir/);
    expect(() => safeJoin("out", "../../evil.html")).toThrow(/outside output dir/);
  });

  it("sanitizeFilename strips directories and unsafe chars", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a/b\\c:d*e?f")).not.toContain("/");
    expect(sanitizeFilename("")).toBe("report");
  });
});

describe("navigation allowlist (P1.12)", () => {
  it("allows listed hosts and subdomains, blocks others", () => {
    expect(() => assertUrlAllowed("https://app.example.com/a", ["example.com"])).not.toThrow();
    expect(() => assertUrlAllowed("https://example.com/", ["example.com"])).not.toThrow();
    expect(() => assertUrlAllowed("https://evil.com/", ["example.com"])).toThrow(/blocked/);
    expect(() => assertUrlAllowed("https://example.com.evil.com/", ["example.com"])).toThrow(
      /blocked/,
    );
  });

  it("mock:/about: URLs pass (offline fixtures)", () => {
    expect(() => assertUrlAllowed("mock:home", ["example.com"])).not.toThrow();
  });

  it("empty allowlist means unrestricted (backwards compat)", () => {
    expect(() => assertUrlAllowed("https://anything.test/", [])).not.toThrow();
    expect(() => assertUrlAllowed("https://anything.test/")).not.toThrow();
  });

  it("session blocks off-allowlist start URLs instead of opening a browser", async () => {
    const adapter = new MockAdapter({
      name: "X",
      start: "home",
      screens: [{ id: "home", title: "H", elements: [] }],
    });
    const open = vi.spyOn(adapter, "open");
    const session = new EveSession({
      adapter,
      startUrl: "https://evil.test/",
      persona: "office-worker",
      seed: 1,
      maxSteps: 2,
      paceScale: 0,
      allowedHosts: ["example.com"],
    });
    const result = await session.run();
    expect(result.endReason).toBe("crashed");
    expect(result.error ?? "").toContain("blocked");
    // The block happens BEFORE any browser opens — no surface ever launches.
    expect(open).not.toHaveBeenCalled();
  }, 30_000);
});
