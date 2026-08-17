/**
 * Phase 2 kernel tests: the modality-variant kernel types, the deprecated
 * WebPerceptView shims (projection equivalence), and the registry-driven,
 * modality-gated scorer.
 */

import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import type { CognitiveContext, Decision, DecisionPolicy } from "../src/cognition/cognition.js";
import { HeuristicCognition } from "../src/cognition/heuristicCognition.js";
import {
  type KernelPercept,
  kernelFromWebPercept,
  webPerceptFromVisualKernel,
} from "../src/core/kernel.js";
import { describeAction, type Percept } from "../src/core/types.js";
import { EveSession } from "../src/engine/index.js";
import { registerMcpVocabulary } from "../src/mcpEval/vocabulary.js";
import { computeScores, type ScoringInput, scoreFromFindings } from "../src/scoring/scorer.js";
import { actionVerbsFor, VISUAL_SURFACE } from "../src/surface/capabilities.js";
import { webPerceptFromKernel } from "../src/surface/kernelView.js";

function webPercept(overrides: Partial<Percept> = {}): Percept {
  return {
    timestamp: 1234,
    url: "https://example.com/form",
    title: "Example form",
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 1600,
    screenshot: null,
    elements: [
      {
        id: 0,
        role: "textbox",
        text: "Email address",
        box: { x: 10, y: 20, width: 200, height: 30 },
        interactive: true,
        disabled: false,
        editable: true,
        focused: false,
        clippedByViewport: false,
      },
      {
        id: 1,
        role: "button",
        text: "Save",
        box: { x: 10, y: 60, width: 80, height: 30 },
        interactive: true,
        disabled: true,
        editable: false,
        focused: false,
        clippedByViewport: false,
      },
    ],
    dialogs: [{ text: "Unsaved changes", box: null }],
    loadingIndicator: true,
    ...overrides,
  };
}

function emptyScoringInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    iterations: [],
    findings: [],
    emotionTimeline: [],
    workflows: [],
    workflowNodes: [],
    revisitRatio: 0,
    usage: { steps: 0, durationMs: 0, screensVisited: 0, uniqueUrls: 0 },
    goalAchieved: false,
    abandoned: false,
    ...overrides,
  };
}

describe("kernel projections (WebPerceptView shims)", () => {
  it("projects a legacy web percept into the kernel one-to-one", () => {
    const kernel = kernelFromWebPercept(webPercept());
    expect(kernel.modality).toBe("visual");
    expect(kernel.frame).toEqual({ address: "https://example.com/form", label: "Example form" });
    expect(kernel.affordances).toHaveLength(2);
    expect(kernel.affordances[0]).toMatchObject({
      kind: "textbox",
      description: "Email address",
      state: { enabled: true, editable: true },
    });
    // Disabled web elements are disabled kernel affordances.
    expect(kernel.affordances[1]?.state.enabled).toBe(false);
    expect(kernel.signals).toEqual([
      { type: "dialog", text: "Unsaved changes" },
      { type: "loading", active: true },
    ]);
  });

  it("round-trips a visual percept through kernel and back without loss", () => {
    const original = webPercept({ loadingIndicator: false });
    const roundTripped = webPerceptFromVisualKernel(
      kernelFromWebPercept(original) as Extract<KernelPercept, { modality: "visual" }>,
    );
    expect(roundTripped.url).toBe(original.url);
    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.viewport).toEqual(original.viewport);
    expect(roundTripped.elements.map((el) => [el.role, el.text, el.box])).toEqual(
      original.elements.map((el) => [el.role, el.text, el.box]),
    );
    expect(roundTripped.dialogs).toEqual(original.dialogs);
    expect(roundTripped.loadingIndicator).toBe(false);
  });

  it("projects a legacy textual percept with an honest empty line buffer", () => {
    const kernel = kernelFromWebPercept(webPercept(), "textual");
    expect(kernel.modality).toBe("textual");
    if (kernel.modality === "textual") {
      // A legacy Percept carries no line buffer; the projection says so
      // rather than inventing one.
      expect(kernel.lines).toEqual([]);
    }
    // Affordances and signals survive regardless of modality.
    expect(kernel.affordances).toHaveLength(2);
    expect(kernel.signals.some((s) => s.type === "dialog")).toBe(true);
  });

  it("projects a textual kernel back into the deprecated web view", () => {
    const kernel: KernelPercept = {
      timestamp: 10,
      frame: { address: "mcp:example", label: "example-server", surfaceState: "menu" },
      modality: "textual",
      lines: ["  add — Add two numbers", "--- error from add ---", "add expects numeric a and b"],
      windowRows: 30,
      scrollLine: 0,
      affordances: [
        {
          id: "tool:add",
          kind: "mcp.tool",
          locator: { kind: "charCell", line: 0, column: 2 },
          description: "add",
          state: { enabled: true },
        },
      ],
      signals: [
        { type: "error", text: "add expects numeric a and b", source: "protocol" },
        { type: "loading", active: false },
      ],
    };
    const view = webPerceptFromKernel(kernel);
    expect(view.url).toBe("mcp:example");
    expect(view.title).toBe("example-server");
    const tool = view.elements.find((el) => el.text === "add");
    expect(tool?.interactive).toBe(true);
    expect(tool?.role).toBe("menuitem");
    // The kernel's typed error collapses onto the web view's dialog slot.
    expect(view.dialogs).toEqual([{ text: "add expects numeric a and b", box: null }]);
    expect(view.loadingIndicator).toBe(false);
  });

  it("accepts open affordance kinds — the kernel is not a closed union", () => {
    const kernel = kernelFromWebPercept(webPercept());
    const extended: KernelPercept = {
      ...kernel,
      modality: "visual",
      affordances: [
        ...kernel.affordances,
        {
          id: "tool:custom",
          kind: "mcp.tool", // a kind no ARIA role union would admit
          locator: { kind: "schemaPath", path: "/tools/custom" },
          description: "A tool affordance",
          state: { enabled: true },
        },
      ],
    } as KernelPercept;
    expect(extended.affordances.at(-1)?.kind).toBe("mcp.tool");
  });
});

describe("kernel action vocabulary", () => {
  it("describes an mcp.invoke action by tool and typed arguments", () => {
    expect(
      describeAction({
        kind: "invoke",
        verb: "mcp.invoke",
        target: null,
        payload: { tool: "add", arguments: { a: 2, b: 3 } },
      }),
    ).toBe('invoke add({"a":2,"b":3})');
  });

  it("declares default and per-surface verb registries via capabilities", () => {
    expect(actionVerbsFor(VISUAL_SURFACE)).toContain("click");
    expect(actionVerbsFor({ ...VISUAL_SURFACE, actionVerbs: ["mcp.invoke"] })).toEqual([
      "mcp.invoke",
    ]);
  });
});

describe("registry-driven, modality-gated scorer", () => {
  it("computes all sixteen built-ins when no modality is given (phase-1 behavior)", () => {
    const scores = computeScores(emptyScoringInput());
    expect(scores).toHaveLength(16);
    expect(scores.some((s) => s.dimension === "visualDesign")).toBe(true);
  });

  it("skips visual-only dimensions on textual sessions — skipped, not failed", () => {
    const scores = computeScores(emptyScoringInput({ modality: "textual" }));
    expect(scores.some((s) => s.dimension === "visualDesign")).toBe(false);
    // The composite still exists and stays in range with renormalized weights.
    const overall = scores.find((s) => s.dimension === "overall");
    expect(overall).toBeDefined();
    expect(overall?.value).toBeGreaterThanOrEqual(0);
    expect(overall?.value).toBeLessThanOrEqual(100);
    // Non-visual dimensions still score.
    expect(scores.some((s) => s.dimension === "usability")).toBe(true);
  });

  it("flows registered mcp.* findings through the session scorer", () => {
    registerMcpVocabulary();
    const scores = computeScores(
      emptyScoringInput({
        modality: "textual",
        findings: [
          {
            id: "F-001",
            severity: "major",
            category: "mcp.robustness",
            title: "Tool accepted clearly-invalid input",
            description: "…",
            evidence: ["fuzz seed 1"],
            url: "mcp:target",
            timestamp: 0,
          },
        ],
      }),
    );
    const robustness = scores.find((s) => s.dimension === "mcp.robustness");
    expect(robustness).toBeDefined();
    expect(robustness?.value).toBe(88); // 100 − 12 (one major), the shared schedule
    expect(robustness?.evidence.join(" ")).toContain("accepted clearly-invalid");
  });

  it("does not report registered dimensions without evidence, or on the wrong modality", () => {
    registerMcpVocabulary();
    const noEvidence = computeScores(emptyScoringInput({ modality: "textual" }));
    expect(noEvidence.some((s) => s.dimension === "mcp.robustness")).toBe(false);
    const wrongModality = computeScores(
      emptyScoringInput({
        modality: "visual",
        findings: [
          {
            id: "F-001",
            severity: "minor",
            category: "mcp.robustness",
            title: "irrelevant here",
            description: "…",
            evidence: ["x"],
            url: "mcp:target",
            timestamp: 0,
          },
        ],
      }),
    );
    expect(wrongModality.some((s) => s.dimension === "mcp.robustness")).toBe(false);
  });

  it("keeps the single severity penalty schedule in scoreFromFindings", () => {
    const mk = (severity: "critical" | "major" | "minor" | "info") => ({
      severity,
      title: `${severity} thing`,
    });
    expect(scoreFromFindings("mcp.conformance", [mk("critical")]).value).toBe(75);
    expect(scoreFromFindings("mcp.conformance", [mk("major")]).value).toBe(88);
    expect(scoreFromFindings("mcp.conformance", [mk("minor")]).value).toBe(96);
    expect(scoreFromFindings("mcp.conformance", [mk("info")]).value).toBe(99);
    const none = scoreFromFindings("mcp.conformance", []);
    expect(none.value).toBe(100);
    expect(none.evidence).toEqual(["No findings on this dimension."]);
  });
});

describe("shim equivalence (web surfaces)", () => {
  it("sees the identical session through the kernel projection as without it", async () => {
    const seen: { percept: Percept; kernel: KernelPercept }[] = [];
    const recordingPolicy = (inner: DecisionPolicy): DecisionPolicy => ({
      name: "kernel-recorder",
      decide(ctx: CognitiveContext): Promise<Decision> {
        if (!ctx.kernel) throw new Error("kernel context missing on a legacy adapter");
        seen.push({ percept: ctx.percept, kernel: ctx.kernel });
        return inner.decide(ctx);
      },
    });

    const baseline = await new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 1234,
      maxSteps: 12,
      paceScale: 0,
    }).run();

    const viaShim = await new EveSession({
      adapter: new MockAdapter(DEMO_APP),
      startUrl: "mock:landing",
      persona: "office-worker",
      seed: 1234,
      maxSteps: 12,
      paceScale: 0,
      policy: recordingPolicy(new HeuristicCognition()),
    }).run();

    // The kernel the policy saw is exactly the projection of the percept.
    expect(seen.length).toBeGreaterThan(0);
    for (const { percept, kernel } of seen) {
      expect(kernel).toEqual(kernelFromWebPercept(percept, "visual"));
    }
    // And the session outcome is identical: the shim changes nothing.
    // (Finding timestamps carry wall-clock jitter; content is compared.)
    expect(viaShim.iterations.map((it) => it.actionDescription)).toEqual(
      baseline.iterations.map((it) => it.actionDescription),
    );
    expect(viaShim.scores.map((s) => [s.dimension, s.value])).toEqual(
      baseline.scores.map((s) => [s.dimension, s.value]),
    );
    const stripTimes = (findings: typeof baseline.findings) =>
      findings.map((f) => ({ ...f, timestamp: 0 }));
    expect(stripTimes(viaShim.findings)).toEqual(stripTimes(baseline.findings));
  }, 30_000);
});
