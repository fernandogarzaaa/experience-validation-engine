import { describe, it, expect, beforeAll } from "vitest";

import { EveSession, type SessionResult } from "../src/engine/session.js";
import { MockAdapter, DEMO_APP } from "../src/browser/index.js";
import {
  buildApplicationMap,
  renderApplicationMapMarkdown,
  renderApplicationMapMermaid,
  type ApplicationMap,
} from "../src/appmap/index.js";
import { runApplicationMap } from "../src/mcp/tools.js";
import { ApplicationMapSchema } from "../src/mcp/schemas.js";

async function explore(): Promise<SessionResult[]> {
  const results: SessionResult[] = [];
  for (const [i, persona] of ["curious-explorer", "power-user", "first-time-user"].entries()) {
    results.push(
      await new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:",
        persona,
        seed: `7#${i}`,
        maxSteps: 40,
      }).run(),
    );
  }
  return results;
}

describe("application map", () => {
  let map: ApplicationMap;
  beforeAll(async () => {
    map = buildApplicationMap(await explore());
  }, 120_000);

  it("discovers multiple screens and transitions", () => {
    expect(map.coverage.screens).toBeGreaterThan(1);
    expect(map.coverage.transitions).toBeGreaterThan(0);
    expect(map.screens.length).toBe(map.coverage.screens);
  });

  it("records the start URL as an entry point", () => {
    expect(map.entryPoints.length).toBeGreaterThan(0);
  });

  it("infers screen purposes from perception", () => {
    const purposes = new Set(map.screens.map((s) => s.purpose));
    // The demo app has a dashboard and a signup/landing area.
    expect([...purposes].some((p) => /dashboard|landing|signup/i.test(p))).toBe(true);
  });

  it("computes in/out degree consistently with transitions", () => {
    const totalOut = map.screens.reduce((s, n) => s + n.outDegree, 0);
    const totalIn = map.screens.reduce((s, n) => s + n.inDegree, 0);
    // Every transition contributes one out-edge and one in-edge (counted with
    // multiplicity), so the totals match the summed transition counts.
    const transitionTotal = map.transitions.reduce((s, t) => s + t.count, 0);
    expect(totalOut).toBe(transitionTotal);
    expect(totalIn).toBe(transitionTotal);
  });

  it("renders a Mermaid navigation graph", () => {
    const mermaid = renderApplicationMapMermaid(map);
    expect(mermaid).toContain("flowchart LR");
    expect(mermaid).toContain("-->");
  });

  it("renders a Markdown report with the graph embedded", () => {
    const md = renderApplicationMapMarkdown(map);
    expect(md).toContain("Application map");
    expect(md).toContain("```mermaid");
    expect(md).toContain("Information architecture");
  });

  it("throws without any sessions", () => {
    expect(() => buildApplicationMap([])).toThrow(/at least one/);
  });
});

describe("mcp eve_application_map", () => {
  it("explores and maps the mock app via the MCP tool", async () => {
    const input = ApplicationMapSchema.parse({ url: "mock:", explorers: 2, seed: 1, max_steps: 30 });
    const out = await runApplicationMap(input);
    expect(out.markdown).toContain("Application map");
    expect((out.structured.screens as unknown[]).length).toBeGreaterThan(1);
    expect(out.structured.coverage).toBeDefined();
  }, 90_000);
});
