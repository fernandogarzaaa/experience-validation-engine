import { describe, expect, it } from "vitest";
import { HeuristicCognition } from "../src/cognition/heuristicCognition.js";
import type { DocumentKernelPercept } from "../src/core/kernel.js";
import {
  artifactFromText,
  HumanityAdapter,
  humanityAdapterFor,
  readText,
} from "../src/humanity/index.js";
import { getPersona } from "../src/personas/index.js";
import { webPerceptFromKernel } from "../src/surface/kernelView.js";

/**
 * A document whose final section is long enough (>40 words) that a skimming
 * persona will skim rather than read it — the shape that used to strand the
 * reader on the last section.
 */
const LONG_TAIL = [
  "# Intro",
  "",
  "Short.",
  "",
  "## Last",
  "",
  "This final section is deliberately long enough to pass the threshold above which a reader who skims will skim rather than read closely, which is the condition that has to keep working if a skimming persona is ever going to reach the end of anything.",
].join("\n");

const DOC = [
  "# Onboarding",
  "",
  "Welcome to the platform. This page explains how to get started.",
  "",
  "## Install",
  "",
  "Run the installer, then sign in.",
  "",
  "## Troubleshoot",
  "",
  "If the SLO dashboard is empty, wait five minutes.",
].join("\n");

function adapter(text = DOC, address = "onboarding.md"): HumanityAdapter {
  return humanityAdapterFor(address, text);
}

describe("HumanityAdapter — perception", () => {
  it("declares a document surface with its own reading verbs", () => {
    const surface = adapter();
    expect(surface.capabilities.modality).toBe("document");
    expect(surface.capabilities.spatial).toBe(false);
    expect(surface.capabilities.actionVerbs).toContain("doc.read");
    expect(surface.capabilities.actionVerbs).not.toContain("click");
  });

  it("perceives one section at a time, in reading order", async () => {
    const surface = adapter();
    const first = await surface.kernelPercept();
    expect(first.modality).toBe("document");
    expect(first.section).toBe(0);
    expect(first.sectionCount).toBe(3);
    expect(first.sectionNoun).toBe("section");
    expect(first.frame.label).toBe("Onboarding");
    expect(first.blocks.map((b) => b.text)).toContain(
      "Welcome to the platform. This page explains how to get started.",
    );
    expect(first.blocks.some((b) => b.text.includes("installer"))).toBe(false);
  });

  it("locates affordances by reading position, not by pixels", async () => {
    const surface = adapter();
    const percept = await surface.kernelPercept();
    for (const affordance of percept.affordances) {
      expect(affordance.locator.kind).toBe("readingOrder");
    }
  });

  it("turns pages and reports how much has been read", async () => {
    const surface = adapter();
    await surface.actKernel({ verb: "doc.read" });
    const read = await surface.kernelPercept();
    expect(read.blocksRead).toBeGreaterThan(0);

    await surface.actKernel({ verb: "doc.next" });
    expect((await surface.kernelPercept()).section).toBe(1);

    await surface.actKernel({ verb: "doc.back" });
    expect((await surface.kernelPercept()).section).toBe(0);
  });

  it("signals the end of the artifact only once every section is read", async () => {
    const surface = adapter();
    const hasEnd = async () =>
      (await surface.kernelPercept()).signals.some((s) => s.type === "end-of-content");

    expect(await hasEnd()).toBe(false);
    for (let i = 0; i < 3; i++) {
      await surface.actKernel({ verb: "doc.read" });
      if (i < 2) await surface.actKernel({ verb: "doc.next" });
    }
    expect(await hasEnd()).toBe(true);
    expect(surface.endMarker()).toBe("[end of document]");
  });

  it("names the end after the artifact's own unit", () => {
    const deck = humanityAdapterFor(
      "d.md",
      "# A\n\nOne.\n\n---\n\n# B\n\nTwo.\n\n---\n\n# C\n\nThree.",
    );
    expect(deck.endMarker()).toBe("[end of slides]");
  });

  it("perceives a comprehension gap after reading something it did not follow", async () => {
    const surface = humanityAdapterFor(
      "dense.md",
      "# Dense\n\nThe idempotent retry path relies on backpressure from the sharded write layer, so SLO attainment degrades whenever replication lag exceeds the configured quorum window during peak ingestion.",
    );
    await surface.actKernel({ verb: "doc.read" });
    const percept = await surface.kernelPercept();
    const gaps = percept.signals.filter((s) => s.type === "comprehension-gap");
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("counts a skimmed section as reached, so a skimmer can finish", async () => {
    // Skimming and reading answer different questions: what the reader
    // retained, and where they have been. Requiring a close read to reach the
    // end stranded skimming personas on the last section, turning them back
    // against a clamped index until they gave up.
    const surface = humanityAdapterFor("d.md", LONG_TAIL);
    await surface.actKernel({ verb: "doc.read" });
    await surface.actKernel({ verb: "doc.next" });
    await surface.actKernel({ verb: "doc.skim" });

    const percept = await surface.kernelPercept();
    expect(percept.signals.some((s) => s.type === "end-of-content")).toBe(true);
    expect(percept.blocksRead).toBe(percept.totalBlocks);
  });

  it("rejects a verb the surface does not have", async () => {
    await expect(adapter().actKernel({ verb: "click" })).rejects.toThrow(/cannot "click"/);
  });

  it("refuses to be read before it is opened", async () => {
    await expect(new HumanityAdapter().kernelPercept()).rejects.toThrow(/open\(\)/);
  });
});

describe("HumanityAdapter — the deprecated web view", () => {
  it("derives a legacy snapshot every phase-1 consumer can still read", async () => {
    const surface = adapter();
    const snapshot = await surface.snapshot();
    expect(snapshot.url).toBe("onboarding.md");
    expect(snapshot.title).toBe("Onboarding");
    expect(snapshot.elements.map((e) => e.text).join(" ")).toContain("Welcome to the platform");
    expect(snapshot.loadingIndicator).toBe(false);
    expect(await surface.screenshot()).toBeNull();
  });

  it("projects reading progress as scroll extent rather than inventing pixels", async () => {
    const surface = adapter();
    const before = await surface.snapshot();
    await surface.actKernel({ verb: "doc.read" });
    const after = await surface.snapshot();
    expect(after.scrollY).toBeGreaterThan(before.scrollY);
    expect(after.scrollHeight).toBe(1000);
  });

  it("reads legacy gestures as the reading acts they correspond to", async () => {
    const surface = adapter();
    await surface.pressKey("PageDown");
    expect((await surface.kernelPercept()).section).toBe(1);
    await surface.scrollBy(-100);
    expect((await surface.kernelPercept()).section).toBe(0);
  });
});

describe("document cognition", () => {
  const policy = new HeuristicCognition();

  async function decideOn(percept: DocumentKernelPercept) {
    const { OperatorMemory } = await import("../src/memory/memory.js");
    const { GoalStack, createGoal } = await import("../src/planning/goals.js");
    const { createRng } = await import("../src/core/random.js");
    const persona = getPersona("first-time-user");
    return policy.decide({
      percept: webPerceptFromKernel(percept),
      previousPercept: null,
      persona,
      emotion: {
        confidence: 0.6,
        frustration: 0,
        trust: 0.5,
        confusion: 0,
        curiosity: 0.5,
        fatigue: 0,
        satisfaction: 0.5,
        interest: 0.5,
        stress: 0,
      },
      memory: new OperatorMemory(persona),
      goals: new GoalStack(createGoal("read it", {})),
      rng: createRng(1),
      step: 0,
      elapsedMs: 0,
      kernel: percept,
    });
  }

  it("reads or skims a section it has not seen, never clicks it", async () => {
    const surface = adapter();
    const decision = await decideOn(await surface.kernelPercept());
    expect(decision.action.kind).toBe("invoke");
    if (decision.action.kind === "invoke") {
      expect(["doc.read", "doc.skim"]).toContain(decision.action.verb);
    }
  });

  it("recognizes the end of the artifact as finishing, not as being stuck", async () => {
    const surface = adapter();
    for (let i = 0; i < 3; i++) {
      await surface.actKernel({ verb: "doc.read" });
      if (i < 2) await surface.actKernel({ verb: "doc.next" });
    }
    const decision = await decideOn(await surface.kernelPercept());
    expect(decision.rationale).toContain("That's the end");
    expect(decision.action.kind).not.toBe("abandon");
  });
});

describe("reading sessions", () => {
  it("runs the whole human loop over an artifact and finishes it", async () => {
    const result = await readText("onboarding.md", DOC, { persona: "first-time-user", seed: 5 });
    expect(result.endReason).toBe("goal-achieved");
    expect(result.iterations.length).toBeGreaterThan(0);
    expect(result.artifact.sections).toHaveLength(3);
    expect(result.comprehension.persona).toBe("first-time-user");
  });

  it("is reproducible for a fixed seed", async () => {
    const options = { persona: "first-time-user", seed: 11 } as const;
    const a = await readText("d.md", DOC, options);
    const b = await readText("d.md", DOC, options);
    expect(a.iterations.map((i) => i.rationale)).toEqual(b.iterations.map((i) => i.rationale));
    expect(a.iterations.map((i) => i.actionDescription)).toEqual(
      b.iterations.map((i) => i.actionDescription),
    );
    expect(a.comprehension.comprehensionScore).toBe(b.comprehension.comprehensionScore);
  });

  it("finishes for skimming personas, at every seed", async () => {
    // The failure this pins was seed-dependent: whether the last section got
    // skimmed came off the session RNG, so a third of seeds ended `abandoned`
    // on a document the reader had in fact reached the end of.
    for (let seed = 1; seed <= 12; seed++) {
      const result = await readText("d.md", LONG_TAIL, { persona: "first-time-user", seed });
      expect(result.endReason, `seed ${seed}`).toBe("goal-achieved");
    }
  }, 30_000);

  it("scores the document-only dimensions and skips the visual ones", async () => {
    const result = await readText(
      "dense.md",
      "# Dense\n\nThe RBAC subsystem enforces the SLO.\n\n![](chart.png)\n",
      { persona: "first-time-user", seed: 2 },
    );
    const dimensions = result.scores.map((s) => s.dimension);
    expect(dimensions).toContain("humanity.comprehension");
    expect(dimensions).not.toContain("visualDesign");
  });

  it("does not treat prose about errors as an error the reader must recover from", async () => {
    const result = await readText(
      "report.md",
      "# Q3\n\nError rate: 0.4%. The failed request count is down. Nothing is wrong.\n",
      { persona: "first-time-user", seed: 4 },
    );
    const goals = result.iterations.map((i) => i.subgoal ?? "");
    expect(goals.some((goal) => goal.includes("recover from the error"))).toBe(false);
  });

  it("reports the reader's own perception, not the artifact's source", async () => {
    const result = await readText(
      "page.html",
      "<html><head><title>T</title></head><body><script>var token='sekrit'</script><p>Hello.</p></body></html>",
      { persona: "first-time-user", seed: 6 },
    );
    const perceived = JSON.stringify(result.artifact);
    expect(perceived).not.toContain("sekrit");
  });
});

describe("artifact reading without a session", () => {
  it("opens an artifact built in memory, no filesystem involved", async () => {
    const surface = new HumanityAdapter();
    surface.openArtifact(artifactFromText("x.md", "# X\n\nHello."));
    expect((await surface.kernelPercept()).frame.address).toBe("x.md");
  });
});
