import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { findingCategoryRegistry, registerFindingCategory } from "../src/core/findingCategories.js";
import { ALL_MODALITIES, EveRegistry, type ScoreDimensionEntry } from "../src/core/registry.js";
import { FINDING_CATEGORIES, SCORE_DIMENSIONS } from "../src/core/types.js";
import { EveSession } from "../src/engine/session.js";
import { PluginManager } from "../src/plugins/plugin.js";
import { defaultRegistries } from "../src/plugins/registries.js";
import { EXPERIENCE_ACTIONS } from "../src/protocol/types.js";
import { actionVerbRegistry, registerActionVerb } from "../src/protocol/verbs.js";
import { dimensionRegistry, dimensionsFor, registerDimension } from "../src/scoring/dimensions.js";

describe("built-in vocabularies are pre-registered unchanged", () => {
  it("pins the serialized values of the former closed unions", () => {
    // These literals are the historical union members; the const tuples the
    // types are now derived from must match them exactly, or stored reports
    // and fixtures would stop matching.
    expect([...SCORE_DIMENSIONS]).toEqual([
      "overall",
      "usability",
      "learnability",
      "accessibility",
      "efficiency",
      "consistency",
      "visualDesign",
      "navigation",
      "workflowQuality",
      "informationArchitecture",
      "onboarding",
      "errorRecovery",
      "responsiveness",
      "userConfidence",
      "cognitiveLoad",
      "trust",
    ]);
    expect([...FINDING_CATEGORIES]).toEqual([
      "usability",
      "navigation",
      "visual",
      "accessibility",
      "performance",
      "content",
      "error-recovery",
      "expectation-violation",
      "workflow",
      "consistency",
    ]);
    expect([...EXPERIENCE_ACTIONS]).toEqual([
      "click",
      "type",
      "press",
      "scroll",
      "navigate",
      "back",
      "read",
      "wait",
      "abandon",
    ]);
  });

  it("seeds all 16 score dimensions as built-ins with mandatory evidence", () => {
    expect(dimensionRegistry.list()).toHaveLength(16);
    for (const id of SCORE_DIMENSIONS) {
      const entry = dimensionRegistry.require(id);
      expect(entry.builtin).toBe(true);
      expect(entry.evidenceRequired).toBe(true);
    }
  });

  it("seeds all 10 finding categories as built-ins with mandatory evidence", () => {
    expect(findingCategoryRegistry.list()).toHaveLength(10);
    for (const id of FINDING_CATEGORIES) {
      const entry = findingCategoryRegistry.require(id);
      expect(entry.builtin).toBe(true);
      expect(entry.evidenceRequired).toBe(true);
    }
  });

  it("seeds the 9 CP/1 canonical verbs as the only on-wire verbs", () => {
    expect(actionVerbRegistry.list()).toHaveLength(9);
    for (const entry of actionVerbRegistry.list()) {
      expect(entry.builtin).toBe(true);
      expect(entry.onCp1Wire).toBe(true);
    }
  });

  it("publishes the composite weights of the built-in overall score", () => {
    expect(dimensionRegistry.require("usability").weight).toBe(0.2);
    expect(dimensionRegistry.require("consistency").weight).toBe(0);
    expect(dimensionRegistry.require("overall").weight).toBe(0);
  });
});

describe("registry semantics", () => {
  it("fails loudly on unknown ids instead of skipping them", () => {
    expect(() => dimensionRegistry.require("no.such.dimension")).toThrow(/unknown score dimension/);
  });

  it("rejects re-registration of an existing id", () => {
    expect(() => registerDimension({ id: "usability", description: "attempted override" })).toThrow(
      /already registered/,
    );
  });

  it("registers a custom dimension with safe defaults", () => {
    registerDimension({ id: "test.trajectoryQuality", appliesTo: ["textual"] });
    const entry = dimensionRegistry.require("test.trajectoryQuality");
    expect(entry.builtin).toBe(false);
    expect(entry.weight).toBe(0); // never reweights an existing composite
    expect(entry.evidenceRequired).toBe(true);
    expect(entry.appliesTo).toEqual(["textual"]);
  });

  it("registers a custom finding category defaulting to all modalities", () => {
    registerFindingCategory({ id: "test.contract-violation" });
    const entry = findingCategoryRegistry.require("test.contract-violation");
    expect(entry.builtin).toBe(false);
    expect(entry.evidenceRequired).toBe(true);
    // The default is "every modality there is", not a frozen list — adding a
    // modality (the humanity seam's "document") must widen it, not orphan
    // categories registered before it existed.
    expect(entry.appliesTo).toEqual(ALL_MODALITIES);
  });

  it("registers custom action verbs as engine-side only", () => {
    registerActionVerb({ id: "test.invoke-tool" });
    const entry = actionVerbRegistry.require("test.invoke-tool");
    expect(entry.builtin).toBe(false);
    expect(entry.onCp1Wire).toBe(false);
    // The canonical CP/1 set is untouched.
    expect(EXPERIENCE_ACTIONS).not.toContain("test.invoke-tool");
  });
});

describe("appliesTo modality gating", () => {
  it("excludes visual-only dimensions from textual surfaces", () => {
    const textual = dimensionsFor("textual");
    expect(textual.some((d) => d.id === "visualDesign")).toBe(false);
    expect(textual.some((d) => d.id === "usability")).toBe(true);
    expect(dimensionsFor("visual").some((d) => d.id === "visualDesign")).toBe(true);
  });

  it("applies the gating to custom dimensions", () => {
    const textual = dimensionsFor("textual");
    expect(textual.some((d) => d.id === "test.trajectoryQuality")).toBe(true);
    expect(dimensionsFor("visual").some((d) => d.id === "test.trajectoryQuality")).toBe(false);
  });

  it("treats entries without appliesTo as modality-agnostic", () => {
    const registry = new EveRegistry<ScoreDimensionEntry>("test");
    registry.register({
      id: "bare",
      builtin: false,
      weight: 0,
      appliesTo: ["visual"],
      evidenceRequired: true,
    });
    expect(registry.listFor("visual")).toHaveLength(1);
    expect(registry.listFor("textual")).toHaveLength(0);
  });
});

describe("plugin-driven registration", () => {
  it("gives plugins the registries via the onRegister lifecycle hook", () => {
    const dimensions = new EveRegistry<ScoreDimensionEntry>("score dimension");
    let received: unknown = null;
    const plugin = {
      name: "test-registrar",
      onRegister(registries: unknown) {
        received = registries;
        (registries as { dimensions: EveRegistry<ScoreDimensionEntry> }).dimensions.register({
          id: "test.pluginDimension",
          builtin: false,
          weight: 0,
          appliesTo: ["visual", "textual"],
          evidenceRequired: true,
        });
      },
    };
    const manager = new PluginManager(() => {}, {
      dimensions,
      findingCategories: defaultRegistries.findingCategories,
      actionVerbs: defaultRegistries.actionVerbs,
    });
    manager.register(plugin);
    expect(received).not.toBeNull();
    expect(dimensions.has("test.pluginDimension")).toBe(true);
  });

  it("routes onRegister failures through the plugin error channel", () => {
    const errors: string[] = [];
    const manager = new PluginManager((err) => errors.push(String(err)));
    manager.register({
      name: "test-failing-registrar",
      onRegister() {
        throw new Error("boom");
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("boom");
  });

  it("registers a custom dimension end-to-end through EveSession", () => {
    // The real wiring: EveSession → PluginManager → default registries.
    new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      plugins: [
        {
          name: "test-e2e-registrar",
          onRegister(registries) {
            registries.dimensions.register({
              id: "test.e2eDimension",
              builtin: false,
              weight: 0,
              appliesTo: ["visual", "textual"],
              evidenceRequired: true,
            });
          },
        },
      ],
    });
    expect(dimensionRegistry.has("test.e2eDimension")).toBe(true);
    // Default registry set is the shared one.
    expect(defaultRegistries.dimensions).toBe(dimensionRegistry);
  });
});
