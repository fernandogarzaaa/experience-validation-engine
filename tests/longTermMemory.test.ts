import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_APP, MockAdapter } from "../src/browser/index.js";
import { UtilityCognition } from "../src/cognition/utilityCognition.js";
import { EveSession } from "../src/engine/session.js";
import { computeLearningMetrics, forgettingCurve } from "../src/memory/learning.js";
import {
  appIdForUrl,
  applyForgetting,
  emptyApplicationMemory,
  FileMemoryStore,
  InMemoryStore,
} from "../src/memory/longTerm.js";

describe("long-term memory store", () => {
  it("derives stable app ids from URLs", () => {
    expect(appIdForUrl("https://app.test/x?y=1")).toBe("https://app.test");
    expect(appIdForUrl("https://app.test/z")).toBe("https://app.test");
  });

  it("round-trips application memory", async () => {
    const store = new InMemoryStore();
    const mem = emptyApplicationMemory("app-1", "App One");
    mem.screens.s1 = {
      signature: "s1",
      url: "u",
      title: "t",
      affordances: { save: 0.8 },
      totalVisits: 1,
      lastSeenSession: 1,
    };
    await store.save(mem);
    const loaded = await store.load("app-1");
    expect(loaded?.screens.s1?.affordances.save).toBe(0.8);
  });

  it("forgets across sessions per the retention trait", () => {
    const mem = emptyApplicationMemory("a", "A");
    mem.screens.s = {
      signature: "s",
      url: "u",
      title: "t",
      affordances: { btn: 0.9 },
      totalVisits: 1,
      lastSeenSession: 1,
    };
    mem.facts["shortcut:x"] = {
      kind: "shortcut",
      statement: "x",
      confidence: 0.9,
      reinforcements: 1,
      lastSeenSession: 1,
    };
    applyForgetting(mem, 6, 0.3); // 5 sessions elapsed, low retention
    const remaining = mem.screens.s?.affordances.btn ?? 0;
    expect(remaining).toBeLessThan(0.9);
  });

  it("forgetting curve is monotonically decreasing", () => {
    const curve = forgettingCurve(0.5, 5);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.retention).toBeLessThanOrEqual(curve[i - 1]!.retention);
    }
    expect(curve[0]!.retention).toBe(1);
  });
});

describe("FileMemoryStore", () => {
  it("round-trips application memory through a JSON file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-memory-"));
    try {
      const file = join(dir, "memory.json");
      const store = new FileMemoryStore(file);
      const mem = emptyApplicationMemory("app-1", "App One");
      mem.screens.s1 = {
        signature: "s1",
        url: "u",
        title: "t",
        affordances: { save: 0.8 },
        totalVisits: 3,
        lastSeenSession: 1,
      };
      await store.save(mem);

      // A fresh instance must read what the previous one wrote.
      const reloaded = new FileMemoryStore(file);
      const loaded = await reloaded.load("app-1");
      expect(loaded?.appName).toBe("App One");
      expect(loaded?.screens.s1?.affordances.save).toBe(0.8);
      expect(loaded?.screens.s1?.totalVisits).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a missing file as an empty store, not an error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-memory-missing-"));
    try {
      const store = new FileMemoryStore(join(dir, "does-not-exist.json"));
      await expect(store.load("anyone")).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("surfaces a corrupted file instead of silently resetting to empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eve-memory-corrupt-"));
    try {
      const file = join(dir, "memory.json");
      await writeFile(file, "{ not: valid json at all", "utf8");
      const store = new FileMemoryStore(file);
      await expect(store.load("app-1")).rejects.toThrow(/could not read/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not leak one store's data into another that has no file yet", async () => {
    // Regression guard: an "empty store" built by shallow-copying a shared
    // module-level constant leaves every instance's collection pointing at
    // the very same object, so writing through one store corrupts every
    // other store's view of "nothing here yet" for the rest of the process.
    const dirA = await mkdtemp(join(tmpdir(), "eve-memory-leak-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "eve-memory-leak-b-"));
    try {
      const storeA = new FileMemoryStore(join(dirA, "memory.json"));
      await storeA.save(emptyApplicationMemory("app-a", "App A"));

      const storeB = new FileMemoryStore(join(dirB, "memory.json"));
      await expect(storeB.load("app-a")).resolves.toBeNull();
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it("does not let a corrupted file's load failure destroy data on save", async () => {
    // A save() that can't read the existing (corrupted) file first must fail
    // loudly rather than overwrite it with a store built from nothing.
    const dir = await mkdtemp(join(tmpdir(), "eve-memory-corrupt-save-"));
    try {
      const file = join(dir, "memory.json");
      await writeFile(file, "not json", "utf8");
      const store = new FileMemoryStore(file);
      await expect(store.save(emptyApplicationMemory("a", "A"))).rejects.toThrow(/could not read/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("cross-session learning", () => {
  it("a returning operator becomes more efficient and records a learning curve", async () => {
    const store = new InMemoryStore();
    const runOnce = async () => {
      const session = new EveSession({
        adapter: new MockAdapter(DEMO_APP),
        startUrl: "mock:landing",
        persona: "first-time-user",
        policy: new UtilityCognition(),
        cognitive: true,
        longTermMemory: store,
        goal: "create a note and save it",
        goalSuccessSignals: ["your notes"],
        seed: 42,
        maxSteps: 40,
        paceScale: 0,
      });
      return session.run();
    };
    const first = await runOnce();
    const second = await runOnce();
    const third = await runOnce();

    // Both complete, and the learning metrics accumulate history.
    expect(third.learningMetrics).toBeDefined();
    expect(third.learningMetrics!.sessions).toBe(3);
    // The later sessions should be no less efficient than the first (learning
    // never makes the operator slower on a stable app).
    expect(third.usage.steps).toBeLessThanOrEqual(first.usage.steps);
    expect(third.learningMetrics!.recognizedScreens).toBeGreaterThan(0);
    // Steps series is recorded for the learning curve.
    expect(third.learningMetrics!.stepsSeries.length).toBe(3);
    void second;
  }, 40_000);
});

describe("learning metrics", () => {
  it("computes a positive learning rate for an improving series", () => {
    const mem = emptyApplicationMemory("a", "A");
    mem.history = [10, 8, 6, 5, 4].map((steps, i) => ({
      session: i + 1,
      timestamp: new Date().toISOString(),
      persona: "p",
      goal: "g",
      steps,
      durationMs: steps * 1000,
      goalAchieved: true,
      abandoned: false,
      confidence: 0.5 + i * 0.08,
      frustration: 0.2,
      trust: 0.6,
      errors: 0,
      surpriseRate: 0.2,
      overallScore: 70 + i,
    }));
    const metrics = computeLearningMetrics(mem);
    expect(metrics.learningRate).toBeGreaterThan(0);
    expect(metrics.timeReductionRatio).toBeLessThan(1);
    expect(metrics.confidenceTrend).toBeGreaterThan(0);
  });
});
