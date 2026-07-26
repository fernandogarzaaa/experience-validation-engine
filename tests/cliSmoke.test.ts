import { describe, expect, it } from "vitest";
import { CliAdapter } from "../src/surface/cli.js";

describe("CliAdapter against a real operator command", () => {
  it("perceives node --version as a textual surface", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node --version", { width: 960, height: 432 });
    const snapshot = await adapter.snapshot();
    expect(snapshot.elements.some((el) => /^v\d+\./.test(el.text))).toBe(true);
    expect(snapshot.elements.every((el) => el.fontSize === undefined)).toBe(true);
    await adapter.close();
  });
});
