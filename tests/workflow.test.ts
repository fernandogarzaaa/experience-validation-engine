import { describe, expect, it } from "vitest";
import { detectWorkflow, WorkflowGraph } from "../src/workflow/index.js";
import type { Percept, VisibleElement } from "../src/core/types.js";

function make(url: string, title: string, headings: string[], controls: string[]): Percept {
  let id = 0;
  const elements: VisibleElement[] = [
    ...headings.map((text) => ({
      id: id++,
      role: "heading" as const,
      text,
      box: { x: 0, y: 0, width: 300, height: 40 },
      interactive: false,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
    })),
    ...controls.map((text) => ({
      id: id++,
      role: "button" as const,
      text,
      box: { x: 0, y: 100, width: 120, height: 36 },
      interactive: true,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: false,
    })),
  ];
  return {
    timestamp: 0,
    url,
    title,
    viewport: { width: 1280, height: 800 },
    scrollY: 0,
    scrollHeight: 800,
    screenshot: null,
    elements,
    dialogs: [],
    loadingIndicator: false,
  };
}

describe("workflow detection", () => {
  it("recognizes login screens", () => {
    const match = detectWorkflow(
      make("https://x.test/login", "Log in", ["Welcome back"], ["Log in", "Password"]),
    );
    expect(match.kind).toBe("login");
    expect(match.confidence).toBeGreaterThan(0.5);
  });

  it("recognizes settings screens", () => {
    const match = detectWorkflow(
      make("https://x.test/settings", "Settings", ["Settings"], ["Save changes"]),
    );
    expect(match.kind).toBe("settings");
  });

  it("recognizes confirmation screens", () => {
    const match = detectWorkflow(
      make("https://x.test/thank-you", "Thanks!", ["Thank you for your order"], []),
    );
    expect(match.kind).toBe("confirmation");
  });

  it("returns unknown for unclassifiable screens", () => {
    const match = detectWorkflow(make("https://x.test/xyz", "xyz", ["Lorem ipsum"], []));
    expect(match.kind).toBe("unknown");
  });
});

describe("workflow graph", () => {
  it("tracks discovery, transitions and completion", () => {
    const graph = new WorkflowGraph();
    const login = make("https://x.test/login", "Log in", ["Welcome back"], ["Log in"]);
    const dash = make("https://x.test/dashboard", "Dashboard", ["Dashboard"], ["New item"]);
    graph.observe(login, 0, null, false);
    graph.observe(dash, 1, 'click "Log in"', false);
    const workflows = graph.discoveredWorkflows();
    const loginFlow = workflows.find((w) => w.kind === "login");
    expect(loginFlow).toBeDefined();
    expect(loginFlow!.completed).toBe(true); // login → dashboard counts as completed
    expect(graph.allTransitions()).toHaveLength(1);
  });

  it("records perceived errors per workflow", () => {
    const graph = new WorkflowGraph();
    const login = make("https://x.test/login", "Log in", ["Welcome back"], ["Log in"]);
    graph.observe(login, 0, null, true);
    const loginFlow = graph.discoveredWorkflows().find((w) => w.kind === "login");
    expect(loginFlow!.errorCount).toBe(1);
  });
});
