import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { EveSession } from "../src/engine/index.js";
import {
  emptyApplicationMemory,
  FileMemoryStore,
  InMemoryStore,
  memoryKeyFor,
} from "../src/memory/index.js";

describe("operator memory isolation (P0.6)", () => {
  it("namespaces profiles by operator", () => {
    expect(memoryKeyFor("https://x.test", "alice")).not.toBe(memoryKeyFor("https://x.test", "bob"));
    expect(memoryKeyFor("https://x.test")).toBe(memoryKeyFor("https://x.test", "shared"));
  });

  it("two operators on the same app do not contaminate each other (InMemory)", async () => {
    const store = new InMemoryStore();
    const alice = emptyApplicationMemory("https://x.test", "X");
    alice.favoriteWorkflows.push({ kind: "checkout", completions: 3, lastSession: 1 });
    await store.save(alice, "alice");

    expect(await store.load("https://x.test", "bob")).toBeNull();
    const back = await store.load("https://x.test", "alice");
    expect(back!.favoriteWorkflows).toHaveLength(1);
  });

  it("same operator keeps cross-session learning", async () => {
    const store = new InMemoryStore();
    const m1 = emptyApplicationMemory("https://x.test", "X");
    m1.sessionsCount = 1;
    await store.save(m1, "alice");
    const m2 = (await store.load("https://x.test", "alice"))!;
    m2.sessionsCount += 1;
    await store.save(m2, "alice");
    expect((await store.load("https://x.test", "alice"))!.sessionsCount).toBe(2);
  });

  it("two operators on the same app do not contaminate each other (File)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eve-mem-"));
    const store = new FileMemoryStore(join(dir, "memory.json"));
    const alice = emptyApplicationMemory("https://x.test", "X");
    alice.knownShortcuts.push("ctrl-s");
    await store.save(alice, "alice");
    expect(await store.load("https://x.test", "bob")).toBeNull();
    expect((await store.load("https://x.test", "alice"))!.knownShortcuts).toEqual(["ctrl-s"]);
  });

  it("migrates legacy bare-appId entries to the shared namespace (File)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eve-mem-legacy-"));
    const path = join(dir, "memory.json");
    const legacy = emptyApplicationMemory("https://x.test", "X");
    legacy.sessionsCount = 4;
    writeFileSync(path, JSON.stringify({ version: 2, applications: { "https://x.test": legacy } }));
    const store = new FileMemoryStore(path);
    // Pre-namespace install reports its memory back, not null.
    const loaded = await store.load("https://x.test", "shared");
    expect(loaded?.sessionsCount).toBe(4);
    // Self-healed: the namespaced key now exists alongside the legacy one.
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      applications: Record<string, unknown>;
    };
    expect(parsed.applications["shared::https://x.test"]).toBeDefined();
  });

  it("migrates legacy bare-appId entries to the shared namespace (InMemory)", async () => {
    const store = new InMemoryStore();
    const legacy = emptyApplicationMemory("https://x.test", "X");
    legacy.sessionsCount = 2;
    // Seed a pre-namespace entry directly (test-only access): InMemoryStore
    // has no file to read legacy state from, so reach the backing map.
    (store as unknown as { store: { applications: Record<string, unknown> } }).store.applications[
      "https://x.test"
    ] = legacy;
    expect((await store.load("https://x.test", "shared"))?.sessionsCount).toBe(2);
  });

  it("session operatorId isolates templates sharing one persona (CodeRabbit PR #39)", async () => {
    const store = new InMemoryStore();
    const run = (operatorId?: string) =>
      new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:landing",
        persona: "office-worker",
        ...(operatorId ? { operatorId } : {}),
        longTermMemory: store,
        seed: 5,
        maxSteps: 6,
        paceScale: 0,
      }).run();
    await run("op-alice");
    await run("op-bob");
    await run(undefined);
    // Same persona template, distinct operators: three isolated profiles
    // (appId is opaque here — assert on the stored namespace keys).
    const keys = Object.keys(store.snapshot().applications).sort();
    expect(keys).toHaveLength(3);
    expect(keys.some((k) => k.startsWith("op-alice::"))).toBe(true);
    expect(keys.some((k) => k.startsWith("op-bob::"))).toBe(true);
    // Legacy callers without operatorId keep the persona-name namespace.
    expect(keys.some((k) => k.startsWith("office-worker::"))).toBe(true);
  }, 60_000);
});

describe("file persistence concurrency safety (P0.7)", () => {
  it("concurrent saves do not silently overwrite each other", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eve-mem-"));
    const store = new FileMemoryStore(join(dir, "memory.json"));
    await Promise.all(
      ["op0", "op1", "op2", "op3", "op4", "op5", "op6", "op7"].map((op) => {
        const m = emptyApplicationMemory(`https://app-${op}.test`, "App");
        m.sessionsCount = 1;
        return store.save(m, op);
      }),
    );
    for (const op of ["op0", "op1", "op2", "op3", "op4", "op5", "op6", "op7"]) {
      const loaded = await store.load(`https://app-${op}.test`, op);
      expect(loaded, `profile for ${op}`).not.toBeNull();
    }
  });

  it("the store file stays valid JSON after concurrent writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eve-mem-"));
    const path = join(dir, "memory.json");
    const store = new FileMemoryStore(path);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const m = emptyApplicationMemory("https://x.test", "X");
        m.sessionsCount = i;
        return store.save(m, `op${i}`);
      }),
    );
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      applications: Record<string, unknown>;
    };
    // All 10 namespaced profiles present — serialized read-modify-write
    // inside the mutex means no save was lost.
    expect(Object.keys(parsed.applications)).toHaveLength(10);
  });
});
