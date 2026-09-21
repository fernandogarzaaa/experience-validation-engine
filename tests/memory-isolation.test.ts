import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
