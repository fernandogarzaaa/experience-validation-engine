import { describe, expect, it } from "vitest";
import {
  analyzeConversation,
  ConversationAdapter,
  converse,
  DEMO_SUPPORT_BOT,
  detectNonAnswer,
  offersHandoff,
  ScriptedBackend,
} from "../src/conversation/index.js";
import { contentWords, isNearMiss, overlapRatio, stem } from "../src/conversation/overlap.js";
import type { ConversationBackend, ConversationReply } from "../src/conversation/types.js";
import type { ConversationTurn } from "../src/core/kernel.js";
import { getPersona } from "../src/personas/index.js";

const firstTimer = getPersona("first-time-user");

/** A bot that resolves the request on the first ask. */
const GOOD_BOT = new ScriptedBackend({
  name: "good-bot",
  kind: "support",
  greeting: "Hi — what can I help you with?",
  latencyMs: 200,
  rules: [
    {
      when: /refund|charged twice/i,
      reply:
        "I can see a duplicate charge of £24.99 on 3 March. I've refunded it — it'll be back within three working days.",
      affordances: [{ id: "h", kind: "handoff", label: "Talk to a person" }],
      ended: true,
    },
  ],
  fallback: "Sorry, I didn't catch that — could you rephrase?",
});

function turns(...pairs: [ConversationTurn["speaker"], string][]): ConversationTurn[] {
  return pairs.map(([speaker, text], index) => ({ id: `t${index}`, speaker, text }));
}

describe("reading a reply the way a person does", () => {
  it("stems inflections, so refund and refunded are the same word", () => {
    expect(stem("refunded")).toBe(stem("refund"));
    expect(stem("charges")).toBe(stem("charge"));
    expect(stem("cancelling")).toBe(stem("cancel"));
  });

  it("does not stem short words into nonsense", () => {
    expect(stem("was")).toBe("was");
    expect(stem("its")).toBe("its");
  });

  it("counts a reply that engages with the question as engaging with it", () => {
    // The regression that mattered most: this exact pair was scored a
    // near-miss before stemming, which called a perfect bot a broken one.
    const asked = "get a refund for being charged twice";
    const answered =
      "I can see a duplicate charge of £24.99 on 3 March. I've refunded it — it'll be back within three working days.";
    expect(overlapRatio(asked, answered)).toBeGreaterThan(0.25);
    expect(isNearMiss(asked, answered)).toBe(false);
  });

  it("catches a fluent answer to a different question", () => {
    expect(
      isNearMiss(
        "get a refund for being charged twice",
        "I can help with returns! Most items can be returned within 30 days. Would you like me to start a return?",
      ),
    ).toBe(true);
  });

  it("never judges a reply too short to be an answer", () => {
    expect(isNearMiss("get a refund for being charged twice", "Sure!")).toBe(false);
    expect(isNearMiss("get a refund for being charged twice", "Done — anything else?")).toBe(false);
  });

  it("never judges a question with nothing in it", () => {
    expect(
      isNearMiss("hi", "Our billing cycle runs monthly and invoices are issued on the first."),
    ).toBe(false);
  });

  it("drops stopwords but keeps the words that carry meaning", () => {
    const words = contentWords("I would like to get a refund please");
    expect(words.has(stem("refund"))).toBe(true);
    expect(words.has("would")).toBe(false);
  });
});

describe("recognizing what the surface said about itself", () => {
  it("separates not understanding from declining", () => {
    expect(detectNonAnswer("Sorry, I didn't quite catch that — could you rephrase?")).toEqual({
      notUnderstood: true,
      refused: false,
    });
    expect(detectNonAnswer("I can't help with billing disputes.")).toEqual({
      notUnderstood: false,
      refused: true,
    });
    expect(detectNonAnswer("Your order shipped on Tuesday.")).toEqual({
      notUnderstood: false,
      refused: false,
    });
  });

  it("spots a route to a person, in text or as an affordance", () => {
    expect(offersHandoff({ text: "Let me connect you with a human agent." })).toBe(true);
    expect(
      offersHandoff({
        text: "Here's the FAQ.",
        affordances: [{ id: "h", kind: "handoff", label: "Chat to us" }],
      }),
    ).toBe(true);
    expect(offersHandoff({ text: "Here's the FAQ." })).toBe(false);
  });
});

describe("ConversationAdapter", () => {
  async function open(backend = GOOD_BOT): Promise<ConversationAdapter> {
    const adapter = new ConversationAdapter({ backend, persona: firstTimer });
    await adapter.open("chat:test", { width: 0, height: 0 });
    return adapter;
  }

  it("declares a conversational surface with its own verbs", async () => {
    const adapter = await open();
    expect(adapter.capabilities.modality).toBe("conversational");
    expect(adapter.capabilities.spatial).toBe(false);
    // A dialogue has no back button — that is the point of the modality.
    expect(adapter.capabilities.canGoBack).toBe(false);
    expect(adapter.capabilities.actionVerbs).toContain("chat.rephrase");
    expect(adapter.capabilities.actionVerbs).not.toContain("click");
  });

  it("opens with the surface's greeting, before the operator says anything", async () => {
    const percept = await (await open()).kernelPercept();
    expect(percept.modality).toBe("conversational");
    expect(percept.turns).toHaveLength(1);
    expect(percept.turns[0]?.speaker).toBe("surface");
    expect(percept.repairAttempts).toBe(0);
  });

  it("records both sides of an exchange in order", async () => {
    const adapter = await open();
    await adapter.actKernel({ verb: "chat.say", payload: "get a refund for being charged twice" });
    const percept = await adapter.kernelPercept();
    expect(percept.turns.map((t) => t.speaker)).toEqual(["surface", "operator", "surface"]);
    expect(percept.lastLatencyMs).toBe(200);
  });

  it("counts a rephrase as a repair and a new question as neither", async () => {
    const adapter = await open();
    await adapter.actKernel({ verb: "chat.say", payload: "something it will not match" });
    expect((await adapter.kernelPercept()).repairAttempts).toBe(0);
    await adapter.actKernel({ verb: "chat.rephrase", payload: "still will not match" });
    expect((await adapter.kernelPercept()).repairAttempts).toBe(1);
    await adapter.actKernel({ verb: "chat.followup", payload: "and another thing" });
    expect((await adapter.kernelPercept()).repairAttempts).toBe(1);
  });

  it("signals a miss the surface admitted, without calling it confident", async () => {
    const adapter = await open();
    await adapter.actKernel({ verb: "chat.say", payload: "something it will not match at all" });
    const signal = (await adapter.kernelPercept()).signals.find((s) => s.type === "not-understood");
    expect(signal).toMatchObject({ confident: false });
  });

  it("signals a confident miss when the surface answered something else", async () => {
    const adapter = await open(new ScriptedBackend(DEMO_SUPPORT_BOT));
    await adapter.actKernel({ verb: "chat.say", payload: "get a refund for being charged twice" });
    const signal = (await adapter.kernelPercept()).signals.find((s) => s.type === "not-understood");
    // The demo bot answers about returns and never admits the miss — the
    // failure people describe as "it kept talking past me".
    expect(signal).toMatchObject({ confident: true });
  });

  it("locates affordances by turn, not by pixels", async () => {
    const adapter = await open();
    await adapter.actKernel({ verb: "chat.say", payload: "get a refund for being charged twice" });
    const percept = await adapter.kernelPercept();
    expect(percept.affordances.length).toBeGreaterThan(0);
    for (const affordance of percept.affordances) {
      expect(affordance.locator.kind).toBe("turn");
    }
  });

  it("only offers affordances from the most recent reply", async () => {
    const adapter = await open(new ScriptedBackend(DEMO_SUPPORT_BOT));
    await adapter.actKernel({ verb: "chat.say", payload: "I want a refund" });
    expect((await adapter.kernelPercept()).affordances.length).toBeGreaterThan(0);
    await adapter.actKernel({ verb: "chat.say", payload: "unmatchable gibberish here" });
    // The chip from two turns ago is gone from the interface, so it is gone
    // from the affordances — offering it back would invent one.
    const kinds = (await adapter.kernelPercept()).affordances.map((a) => a.kind);
    expect(kinds).not.toContain("chat.suggestion");
  });

  it("treats a backend that throws as the bot dying, not as a crash", async () => {
    const broken: ConversationBackend = {
      name: "broken",
      async send(): Promise<ConversationReply> {
        throw new Error("socket hang up");
      },
    };
    const adapter = new ConversationAdapter({ backend: broken, persona: firstTimer });
    await adapter.open("chat:broken", { width: 0, height: 0 });
    await adapter.actKernel({ verb: "chat.say", payload: "hello?" });
    const percept = await adapter.kernelPercept();
    expect(percept.turns.at(-1)?.text).toContain("socket hang up");
    expect(percept.signals.some((s) => s.type === "surface-terminated")).toBe(true);
  });

  it("buffers typing and sends on Enter, the way a person composes", async () => {
    const adapter = await open();
    await adapter.typeText("get a refund", 0);
    expect((await adapter.kernelPercept()).turns).toHaveLength(1);
    await adapter.typeText(" for being charged twice", 0);
    await adapter.pressKey("Enter");
    const percept = await adapter.kernelPercept();
    expect(percept.turns[1]?.text).toBe("get a refund for being charged twice");
  });

  it("rejects a verb the surface does not have", async () => {
    const adapter = await open();
    await expect(adapter.actKernel({ verb: "click" })).rejects.toThrow(/cannot "click"/);
  });

  it("refuses to be used before it is opened", async () => {
    const adapter = new ConversationAdapter({ backend: GOOD_BOT });
    await expect(adapter.kernelPercept()).rejects.toThrow(/open\(\)/);
  });

  it("derives a transcript every phase-1 consumer can still read", async () => {
    const adapter = await open();
    await adapter.actKernel({ verb: "chat.say", payload: "get a refund for being charged twice" });
    const snapshot = await adapter.snapshot();
    const text = snapshot.elements.map((e) => e.text).join(" ");
    expect(text).toContain("You:");
    expect(text).toContain("Assistant:");
    expect(await adapter.screenshot()).toBeNull();
  });
});

describe("conversation analysis", () => {
  const base = {
    address: "chat:test",
    kind: "support" as const,
    persona: firstTimer,
    goal: "get a refund for being charged twice",
  };

  it("says nothing about a conversation that resolved on the first ask", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        ["surface", "I've refunded the duplicate charge of £24.99 — it'll be back in three days."],
      ),
      repairAttempts: 0,
      goalAchieved: true,
    });
    expect(analysis.findings).toEqual([]);
    expect(analysis.understanding).toBe(100);
    expect(analysis.silentMisses).toBe(0);
  });

  it("reports repeated rephrasing as critical", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        ["surface", "Sorry, I didn't catch that — could you rephrase?"],
        ["operator", "I was charged twice and need a refund"],
        ["surface", "Sorry, I didn't catch that — could you rephrase?"],
        ["operator", "refund duplicate charge"],
        ["surface", "Sorry, I didn't catch that — could you rephrase?"],
      ),
      repairAttempts: 3,
      goalAchieved: false,
    });
    const titles = analysis.findings.map((f) => f.title).join(" | ");
    expect(titles).toContain("rephrase 3 times");
    expect(analysis.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("separates a confident near-miss from an admitted one", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        [
          "surface",
          "Our billing cycle runs monthly and invoices are issued on the first of each month. You can view them under Billing in account settings.",
        ],
      ),
      repairAttempts: 0,
      goalAchieved: false,
    });
    expect(analysis.silentMisses).toBe(1);
    expect(analysis.admittedMisses).toBe(0);
    expect(analysis.findings.map((f) => f.title).join(" ")).toContain("without saying so");
  });

  it("flags a failing conversation with no route to a person", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        ["surface", "Sorry, I didn't catch that — could you rephrase?"],
      ),
      repairAttempts: 1,
      goalAchieved: false,
    });
    expect(analysis.everOfferedHandoff).toBe(false);
    expect(analysis.findings.map((f) => f.title).join(" ")).toContain("No route to a person");
  });

  it("does not flag a handoff that was offered", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        [
          "surface",
          "Sorry, I didn't catch that. I can connect you with a human agent if you'd like.",
        ],
      ),
      repairAttempts: 1,
      goalAchieved: false,
    });
    expect(analysis.everOfferedHandoff).toBe(true);
    expect(analysis.findings.map((f) => f.title).join(" ")).not.toContain("No route to a person");
  });

  it("notices being asked for something already given", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "My order number is 44821 and I was charged twice"],
        ["surface", "I can help with that. What's your order number?"],
      ),
      repairAttempts: 0,
      goalAchieved: false,
    });
    expect(analysis.findings.map((f) => f.title).join(" ")).toContain("already given");
  });

  it("reports dead air the operator sat through", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: [
        { id: "t0", speaker: "operator", text: "get a refund for being charged twice" },
        {
          id: "t1",
          speaker: "surface",
          text: "I've refunded the duplicate charge — it'll be back within three working days.",
          latencyMs: 21_000,
        },
      ],
      repairAttempts: 0,
      goalAchieved: true,
    });
    expect(analysis.maxLatencyMs).toBe(21_000);
    expect(analysis.findings.map((f) => f.title).join(" ")).toContain("longer than 5s");
  });

  it("is deterministic for the same transcript", () => {
    const input = {
      ...base,
      turns: turns(["operator", "get a refund"], ["surface", "Sorry, I didn't catch that."]),
      repairAttempts: 1,
      goalAchieved: false,
    };
    expect(analyzeConversation(input)).toEqual(analyzeConversation(input));
  });

  it("cites evidence on every finding, in a conversation category", () => {
    const analysis = analyzeConversation({
      ...base,
      turns: turns(
        ["operator", "get a refund for being charged twice"],
        [
          "surface",
          "Our billing cycle runs monthly and invoices are issued on the first of the month.",
        ],
      ),
      repairAttempts: 3,
      goalAchieved: false,
    });
    expect(analysis.findings.length).toBeGreaterThan(0);
    for (const finding of analysis.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.category.startsWith("conversation.")).toBe(true);
    }
  });
});

describe("conversation sessions", () => {
  it("resolves against a bot that understands, and says so", async () => {
    const result = await converse(GOOD_BOT, {
      persona: "first-time-user",
      goal: "get a refund for being charged twice",
      goalSuccessSignals: ["refunded"],
      seed: 7,
    });
    expect(result.endReason).toBe("goal-achieved");
    expect(result.conversation.understanding).toBe(100);
    expect(result.findings).toEqual([]);
  }, 30_000);

  it("gives up on a bot that keeps talking past the person", async () => {
    const result = await converse(new ScriptedBackend(DEMO_SUPPORT_BOT), {
      persona: "first-time-user",
      goal: "get a refund for being charged twice",
      seed: 3,
    });
    expect(result.endReason).toBe("abandoned");
    expect(result.conversation.silentMisses).toBeGreaterThan(0);
    expect(result.conversation.repairAttempts).toBeGreaterThan(0);
  }, 30_000);

  it("tries at least once before walking away", async () => {
    // Nobody leaves on the first misunderstanding — being missed once reads
    // as bad luck, not as a broken surface.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = await converse(new ScriptedBackend(DEMO_SUPPORT_BOT), {
        persona: "first-time-user",
        goal: "get a refund for being charged twice",
        seed,
      });
      expect(result.conversation.repairAttempts, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  }, 60_000);

  it("is reproducible for a fixed seed", async () => {
    const options = {
      persona: "first-time-user",
      goal: "cancel my subscription",
      seed: 11,
    } as const;
    const a = await converse(new ScriptedBackend(DEMO_SUPPORT_BOT), options);
    const b = await converse(new ScriptedBackend(DEMO_SUPPORT_BOT), options);
    expect(a.transcript.map((t) => t.text)).toEqual(b.transcript.map((t) => t.text));
    expect(a.conversation.understanding).toBe(b.conversation.understanding);
  }, 30_000);

  it("scores the conversation dimensions and skips the visual ones", async () => {
    const result = await converse(new ScriptedBackend(DEMO_SUPPORT_BOT), {
      persona: "first-time-user",
      goal: "get a refund for being charged twice",
      seed: 3,
    });
    const dimensions = result.scores.map((s) => s.dimension);
    expect(dimensions.some((d) => d.startsWith("conversation."))).toBe(true);
    expect(dimensions).not.toContain("visualDesign");
  }, 30_000);
});
