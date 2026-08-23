import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { TwinSessionSchema } from "../src/mcp/schemas.js";
import { runTwinSessionTool } from "../src/mcp/tools.js";
import {
  createTwin,
  evolveTwin,
  FileTwinStore,
  InMemoryTwinStore,
  renderTwinMarkdown,
  runTwinSession,
  type TwinProfile,
  twinPersona,
} from "../src/twins/index.js";

describe("digital twin lifecycle", () => {
  it("creates a twin seeded from its base persona", () => {
    const twin = createTwin({ id: "pu", name: "Power User A", basePersona: "power-user" });
    expect(twin.evolution.sessions).toBe(0);
    expect(twin.evolution.confidenceBaseline).toBeGreaterThan(0);
    expect(twinPersona(twin).name).toBe("Power User A");
  });

  it("rejects an unknown base persona", () => {
    expect(() => createTwin({ id: "x", name: "X", basePersona: "not-real" })).toThrow();
  });

  it("evolves purely from an outcome (expertise grows, confidence drifts)", () => {
    const twin = createTwin({ id: "a", name: "A", basePersona: "first-time-user" });
    const e1 = evolveTwin(twin.evolution, {
      url: "mock:",
      overall: 80,
      completed: true,
      finalTrust: 0.7,
      steps: 10,
    });
    expect(e1.sessions).toBe(1);
    expect(e1.expertise).toBeGreaterThan(twin.evolution.expertise);
    expect(e1.scoreHistory).toEqual([80]);
    const e2 = evolveTwin(e1, {
      url: "mock:",
      overall: 85,
      completed: true,
      finalTrust: 0.75,
      steps: 8,
    });
    expect(e2.sessions).toBe(2);
    expect(e2.expertise).toBeGreaterThan(e1.expertise);
    expect(e2.appsExperienced).toEqual(["mock:"]); // same app, not double-counted
  });

  it("runs and evolves across sessions, accumulating memory", async () => {
    let twin: TwinProfile = createTwin({
      id: "pa",
      name: "Power User A",
      basePersona: "power-user",
    });
    for (let i = 0; i < 3; i += 1) {
      const r = await runTwinSession(twin, {
        adapter: new MockAdapter(DEMO_APP),
        url: "mock:",
        goal: "create a note and save it",
        seed: 1,
        maxSteps: 40,
      });
      twin = r.twin;
    }
    expect(twin.evolution.sessions).toBe(3);
    expect(twin.evolution.scoreHistory).toHaveLength(3);
    expect(Object.keys(twin.memories).length).toBeGreaterThanOrEqual(1);
    expect(renderTwinMarkdown(twin)).toContain("Power User A");
  }, 90_000);
});

describe("twin stores", () => {
  it("round-trips a twin through the in-memory store", async () => {
    const store = new InMemoryTwinStore();
    const twin = createTwin({ id: "t", name: "T", basePersona: "power-user" });
    await store.save(twin);
    expect((await store.load("t"))?.name).toBe("T");
    expect(await store.list()).toHaveLength(1);
  });

  it("persists a twin to a JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-twins-"));
    try {
      const store = new FileTwinStore(join(dir, "twins.json"));
      await store.save(
        createTwin({ id: "sr", name: "Senior Accountant", basePersona: "office-worker" }),
      );
      const reloaded = new FileTwinStore(join(dir, "twins.json"));
      expect((await reloaded.load("sr"))?.name).toBe("Senior Accountant");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a missing file as an empty store, not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-twins-missing-"));
    try {
      const store = new FileTwinStore(join(dir, "does-not-exist.json"));
      await expect(store.load("anyone")).resolves.toBeNull();
      await expect(store.list()).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not leak one store's data into another that has no file yet", async () => {
    // Regression guard: an "empty store" built by shallow-copying a shared
    // module-level constant leaves every instance's collection pointing at
    // the very same object, so writing through one store corrupts every
    // other store's view of "nothing here yet" for the rest of the process.
    const dirA = await mkdtemp(join(tmpdir(), "eve-twins-leak-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "eve-twins-leak-b-"));
    try {
      const storeA = new FileTwinStore(join(dirA, "twins.json"));
      await storeA.save(createTwin({ id: "a", name: "A", basePersona: "office-worker" }));

      const storeB = new FileTwinStore(join(dirB, "twins.json"));
      await expect(storeB.list()).resolves.toEqual([]);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it("surfaces a corrupted file instead of silently resetting to empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-twins-corrupt-"));
    try {
      const file = join(dir, "twins.json");
      await writeFile(file, "{ this is not valid JSON", "utf8");
      const store = new FileTwinStore(file);
      await expect(store.load("sr")).rejects.toThrow(/could not read/);
      await expect(store.list()).rejects.toThrow(/could not read/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mcp eve_twin_session", () => {
  it("creates, persists, and evolves a twin across calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-twin-mcp-"));
    const file = join(dir, "twins.json");
    try {
      const first = TwinSessionSchema.parse({
        twin_file: file,
        twin_id: "college-student",
        name: "College Student",
        base_persona: "first-time-user",
        url: "mock:",
        seed: 1,
        max_steps: 25,
      });
      const out1 = await runTwinSessionTool(first);
      expect((out1.structured.twin as { evolution: { sessions: number } }).evolution.sessions).toBe(
        1,
      );

      // Second call omits name/base_persona — it must load the existing twin.
      const second = TwinSessionSchema.parse({
        twin_file: file,
        twin_id: "college-student",
        url: "mock:",
        seed: 2,
        max_steps: 25,
      });
      const out2 = await runTwinSessionTool(second);
      expect((out2.structured.twin as { evolution: { sessions: number } }).evolution.sessions).toBe(
        2,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("errors if a new twin lacks name/base_persona", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-twin-err-"));
    try {
      const input = TwinSessionSchema.parse({
        twin_file: join(dir, "t.json"),
        twin_id: "ghost",
        url: "mock:",
      });
      await expect(runTwinSessionTool(input)).rejects.toThrow(/does not exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
