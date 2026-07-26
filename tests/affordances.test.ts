import { describe, expect, it } from "vitest";
import { detectAffordances, stripAnsi } from "../src/surface/affordances.js";

describe("stripAnsi", () => {
  it("removes color escape sequences", () => {
    expect(stripAnsi("[31merror[0m")).toBe("error");
  });
});

describe("detectAffordances", () => {
  it("finds a backtick-quoted command", () => {
    const found = detectAffordances(["Run `npm install` to fix this."]);
    expect(found).toHaveLength(1);
    expect(found[0].command).toBe("npm install");
    expect(found[0].role).toBe("button");
    expect(found[0].line).toBe(0);
  });

  it("finds an interactive prompt as an editable affordance", () => {
    const found = detectAffordances(["Enter your name: "]);
    expect(found).toHaveLength(1);
    expect(found[0].role).toBe("textbox");
  });

  it("finds subcommands in a help listing", () => {
    const found = detectAffordances(["Commands:", "  start    Start the proxy", "  stop     Stop it"]);
    expect(found.map((a) => a.command)).toEqual(["start", "stop"]);
  });

  it("returns nothing for a bare stack trace", () => {
    const found = detectAffordances([
      "Error: ENOENT: no such file or directory",
      "    at Object.openSync (node:fs:600:3)",
      "    at readFileSync (node:fs:468:35)",
    ]);
    expect(found).toEqual([]);
  });
});
