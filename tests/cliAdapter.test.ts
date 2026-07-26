import { describe, expect, it } from "vitest";
import { CliAdapter } from "../src/surface/cli.js";

const VIEWPORT = { width: 960, height: 432 };

describe("CliAdapter", () => {
  it("declares a textual, non-spatial surface", () => {
    expect(new CliAdapter().capabilities.spatial).toBe(false);
    expect(new CliAdapter().capabilities.modality).toBe("textual");
  });

  it("perceives process output as a text frame", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    const text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("Proxy is not running.");
    await adapter.close();
  });

  it("exposes a suggested command as an interactive affordance", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    const actionable = snapshot.elements.filter((el) => el.interactive);
    expect(actionable.map((el) => el.text)).toContain("restart-proxy");
    await adapter.close();
  });

  it("presents a bare stack trace as a dead end with no affordances", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/hostile-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    expect(snapshot.elements.filter((el) => el.interactive)).toHaveLength(0);
    await adapter.close();
  });

  it("never produces a screenshot", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    expect(await adapter.screenshot()).toBeNull();
    await adapter.close();
  });

  it("rejects when the binary does not exist", async () => {
    const adapter = new CliAdapter();
    await expect(
      adapter.open("cli:definitely-not-a-real-binary-xyz", VIEWPORT),
    ).rejects.toThrow();
  });

  it("settles on an interactive process without waiting for it to exit", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/interactive-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    const text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("partial line");
    expect(text).toContain("Waiting for input:");
    await adapter.close();
  });
});
