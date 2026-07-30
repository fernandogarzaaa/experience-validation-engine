import { describe, expect, it } from "vitest";
import { ConfigError, resolveConfig } from "../src/config/index.js";

describe("configuration", () => {
  it("applies defaults", () => {
    const config = resolveConfig({ url: "https://x.test" });
    expect(config.browser).toBe("playwright");
    expect(config.maxSteps).toBe(60);
    expect(config.plugins.accessibility).toBe(true);
    expect(config.viewport).toEqual({ width: 1280, height: 800 });
  });

  it("rejects missing url", () => {
    expect(() => resolveConfig({})).toThrow(ConfigError);
  });

  it("rejects unknown browsers and strategies", () => {
    expect(() => resolveConfig({ url: "https://x.test", browser: "ie6" })).toThrow(/browser/);
    expect(() => resolveConfig({ url: "https://x.test", explorationStrategy: "chaotic" })).toThrow(
      /explorationStrategy/,
    );
  });

  it("range-checks numbers", () => {
    expect(() => resolveConfig({ url: "https://x.test", maxSteps: -1 })).toThrow(/out of range/);
    expect(() => resolveConfig({ url: "https://x.test", paceScale: 99 })).toThrow(/out of range/);
  });

  it("patience shorthand derives a modified persona", () => {
    const config = resolveConfig({
      url: "https://x.test",
      persona: "office-worker",
      patience: 0.9,
    });
    expect(typeof config.persona).not.toBe("string");
    if (typeof config.persona !== "string") {
      expect(config.persona.traits.patience).toBe(0.9);
    }
  });

  it("validates inline custom personas eagerly", () => {
    expect(() =>
      resolveConfig({
        url: "https://x.test",
        customPersonas: [{ name: "broken", traits: { patience: 7 } }],
      }),
    ).toThrow(/out of range/);
  });

  it("accepts plugin objects", () => {
    const config = resolveConfig({
      url: "https://x.test",
      plugins: { llmCritic: { model: "claude-opus-4-8", maxScreens: 2 } },
    });
    expect(config.plugins.llmCritic).toMatchObject({ maxScreens: 2 });
  });
});
