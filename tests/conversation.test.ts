import { describe, expect, it } from "vitest";
import {
  analyzeConversation,
  ConversationAdapter,
  converse,
  DEMO_SUPPORT_BOT,
  detectNonAnswer,
  HttpBackend,
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

describe("replies are untrusted input", () => {
  /**
   * Every pattern in this seam runs over what a *bot* said, and a bot is
   * whatever endpoint the caller pointed EVE at. A reply that happens to be
   * a long run of the characters a pattern cares about is ordinary input,
   * not an attack that has to get past anything first — so matching has to
   * stay linear. The handoff pattern used to phrase its optional article as
   * `\s+(?:a|an|our)?\s*`, which let a whitespace run belong to two matchers
   * at once and cost quadratic time: 415ms at 16k characters.
   */
  const BUDGET_MS = 1000;

  function timed(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }

  it("reads a reply that is mostly whitespace without backtracking", () => {
    const hostile = `escalating you to${"  ".repeat(32_000)}x`;
    expect(timed(() => offersHandoff({ text: hostile }))).toBeLessThan(BUDGET_MS);
    expect(timed(() => detectNonAnswer(hostile))).toBeLessThan(BUDGET_MS);
  });

  it("analyses a transcript of hostile replies without backtracking", () => {
    const hostile = `what is your ${" ".repeat(32_000)}x`;
    const elapsed = timed(() =>
      analyzeConversation({
        address: "chat:test",
        kind: "support",
        persona: firstTimer,
        goal: "get a refund",
        turns: turns(["operator", "get a refund"], ["surface", hostile]),
        repairAttempts: 0,
        goalAchieved: false,
      }),
    );
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("still recognizes every way a surface offers a person", () => {
    for (const text of [
      "Let me connect you with a human agent.",
      "I will transfer you to an advisor.",
      "Escalating you to our support team now.",
      "You can speak with a representative.",
      "Our live chat is available 9-5.",
    ]) {
      expect(offersHandoff({ text }), text).toBe(true);
    }
  });

  it("does not mistake ordinary talk for a handoff", () => {
    for (const text of [
      "I can talk to you about returns.",
      "Here is the FAQ.",
      "Your agent settings are under Account.",
    ]) {
      expect(offersHandoff({ text }), text).toBe(false);
    }
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

describe("regressions found in review", () => {
  /**
   * Seven bugs the review of this PR turned up. Each is pinned by the
   * behavior a person would notice, not by the shape of the fix, so a future
   * refactor that reintroduces the bug fails here rather than passing on a
   * technicality.
   */

  /** A bot that never helps — it only ever points at the Help Centre. */
  const uselessBot = () =>
    new ScriptedBackend({
      name: "useless",
      kind: "support",
      greeting: "Hi!",
      latencyMs: 10,
      rules: [],
      fallback: "Please check our Help Centre for more information.",
    });

  it("does not read the operator's own words as evidence that they succeeded", async () => {
    // Half of a chat window is the person typing. Someone asking about a
    // refund has not been given one, so their own words can never satisfy a
    // goal signal — this used to report a bot that never helped as a success.
    const result = await converse(uselessBot(), {
      persona: "first-time-user",
      goal: "get a refund for being charged twice",
      goalSuccessSignals: ["refund"],
      seed: 5,
    });
    expect(result.goalAchieved).toBe(false);
    expect(result.transcript.some((t) => t.speaker === "operator" && /refund/i.test(t.text))).toBe(
      true,
    );
  }, 30_000);

  it("reads the surface's own words as evidence that they did", async () => {
    const helpful = new ScriptedBackend({
      name: "helpful",
      kind: "support",
      greeting: "Hi!",
      latencyMs: 10,
      rules: [{ when: /refund|charge/i, reply: "I have refunded the duplicate charge." }],
      fallback: "Sorry, I did not catch that.",
    });
    const result = await converse(helpful, {
      persona: "first-time-user",
      goal: "get a refund for being charged twice",
      goalSuccessSignals: ["refunded"],
      seed: 5,
    });
    expect(result.goalAchieved).toBe(true);
  }, 30_000);

  it("keeps the surface's suggested replies reachable in the legacy view", async () => {
    // Affordance ids are `${turn.id}:${entry.id}`; keying the projection by
    // bare turn id dropped every chip, which blinded `clickAt` and every
    // pre-kernel consumer.
    const withChips = new ScriptedBackend({
      name: "chips",
      latencyMs: 10,
      rules: [
        {
          when: /.*/,
          reply: "Would you like to start a return?",
          affordances: [{ id: "s1", kind: "suggestion", label: "Start a return" }],
        },
      ],
      fallback: "?",
    });
    const adapter = new ConversationAdapter({ backend: withChips, persona: firstTimer });
    await adapter.open("chat:chips", { width: 0, height: 0 });
    await adapter.actKernel({ verb: "chat.say", payload: "hello" });

    const kernel = await adapter.kernelPercept();
    expect(kernel.affordances.map((a) => a.kind)).toContain("chat.suggestion");

    const snapshot = await adapter.snapshot();
    const interactive = snapshot.elements.filter((element) => element.interactive);
    expect(interactive.map((element) => element.text)).toContain("Start a return");
  });

  it("counts a declared miss as admitted, not as a silent near-miss", () => {
    // A scripted fallback intent *is* the surface saying it did not follow,
    // whatever words it dresses that in. Reading the wording instead turned
    // an admission into the opposite verdict.
    const analysis = analyzeConversation({
      address: "chat:t",
      kind: "support",
      persona: firstTimer,
      goal: "get a refund",
      repairAttempts: 0,
      goalAchieved: false,
      turns: [
        { id: "t0", speaker: "operator", text: "I was charged twice for my order" },
        {
          id: "t1",
          speaker: "surface",
          text: "Please check our Help Centre for more information.",
          notUnderstood: true,
          refused: false,
          handoff: false,
        },
      ],
    });
    expect(analysis.admittedMisses).toBe(1);
    expect(analysis.silentMisses).toBe(0);
  });

  it("scores an honest bot above an evasive one on recovery", () => {
    // The formula used to read `admittedMisses > 0 ? 0.2 : 0.4`, which
    // rewarded bluffing over saying "I didn't follow that".
    const base = {
      address: "chat:t",
      kind: "support" as const,
      persona: firstTimer,
      goal: "get a refund",
      repairAttempts: 1,
      goalAchieved: false,
    };
    const asked = { id: "t0", speaker: "operator" as const, text: "I was charged twice" };

    const honest = analyzeConversation({
      ...base,
      turns: [
        asked,
        {
          id: "t1",
          speaker: "surface",
          text: "Sorry, I did not catch that — could you rephrase?",
          notUnderstood: true,
          refused: false,
          handoff: false,
        },
      ],
    });
    const evasive = analyzeConversation({
      ...base,
      turns: [
        asked,
        {
          id: "t1",
          speaker: "surface",
          text: "Our billing cycle runs monthly and invoices are issued on the first of each month in your settings.",
          notUnderstood: false,
          refused: false,
          handoff: false,
        },
      ],
    });

    expect(honest.recovery).toBeGreaterThan(evasive.recovery);
  });

  it("gives a conversation that never failed full marks for recovery", () => {
    const analysis = analyzeConversation({
      address: "chat:t",
      kind: "support",
      persona: firstTimer,
      goal: "get a refund",
      repairAttempts: 0,
      goalAchieved: true,
      turns: turns(
        ["operator", "I was charged twice for my order"],
        ["surface", "I have refunded the duplicate charge to your card."],
      ),
    });
    expect(analysis.recovery).toBe(100);
  });

  it("puts the message in the query string when the endpoint takes GET", async () => {
    const seen: string[] = [];
    const backend = new HttpBackend({
      url: "https://bot.example/chat",
      method: "GET",
      fetchImpl: (async (input: string) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ reply: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    await backend.send("where is my order");
    expect(seen[0]).toContain("message=where+is+my+order");
  });

  it("lets a persistent reader reach the last phrasing it knows", async () => {
    // `rephrase` degrades over three attempts, ending in bare keywords.
    // Capping give-up at two made that last stage unreachable in any run.
    const patient = getPersona("power-user");
    const result = await converse(uselessBot(), {
      persona: patient,
      goal: "get a refund for being charged twice",
      seed: 3,
      maxSteps: 30,
    });
    expect(result.conversation.repairAttempts).toBeGreaterThanOrEqual(1);
    expect(result.conversation.repairAttempts).toBeLessThanOrEqual(3);
  }, 30_000);
});

describe("waiting is part of the experience", () => {
  /**
   * EVE keeps modeled human time and wall-clock time apart so runs replay
   * (`src/core/clock.ts`). A surface's own response latency is neither — the
   * operator did not choose to spend it, and on a simulated clock nothing
   * observes it, because it elapses inside the adapter. It used to be
   * recorded in the transcript and then charged to nobody: a bot taking
   * twelve seconds a turn produced byte-identical frustration and simulated
   * time to one taking a tenth of a second.
   */
  const slowBot = (latencyMs: number) =>
    new ScriptedBackend({
      name: "slow",
      kind: "support",
      greeting: "Hi!",
      latencyMs,
      rules: [{ when: /.*/, reply: "Please check our Help Centre for more information." }],
      fallback: "?",
    });

  async function run(latencyMs: number) {
    return converse(slowBot(latencyMs), {
      persona: "impatient-user",
      goal: "get a refund for being charged twice",
      seed: 4,
    });
  }

  it("charges the operator for time the surface made them wait", async () => {
    const quick = await run(100);
    const slow = await run(12_000);
    expect(slow.usage.durationMs).toBeGreaterThan(quick.usage.durationMs * 3);
  }, 30_000);

  it("wears an impatient person down faster when the surface is slow", async () => {
    const quick = await run(100);
    const slow = await run(12_000);
    const frustrationOf = (result: Awaited<ReturnType<typeof run>>) =>
      result.iterations.at(-1)?.emotion.frustration ?? 0;

    expect(frustrationOf(slow)).toBeGreaterThan(frustrationOf(quick));
    // And they leave sooner, having got no further.
    expect(slow.usage.steps).toBeLessThanOrEqual(quick.usage.steps);
  }, 30_000);

  it("never charges the same wait twice", async () => {
    const adapter = new ConversationAdapter({
      backend: slowBot(5_000),
      persona: firstTimer,
    });
    await adapter.open("chat:slow", { width: 0, height: 0 });
    await adapter.actKernel({ verb: "chat.say", payload: "hello" });

    // The greeting plus one reply; drained on read, so a second ask is zero.
    expect(adapter.lastWaitMs()).toBeGreaterThan(0);
    expect(adapter.lastWaitMs()).toBe(0);
  }, 20_000);

  it("leaves surfaces that report no wait paced exactly as before", async () => {
    // Every adapter but this one leaves `lastWaitMs` undefined, and the
    // session must treat that as "nothing to charge" rather than as zero
    // time having passed at all.
    const { MockAdapter, DEMO_APP } = await import("../src/browser/index.js");
    const { EveSession } = await import("../src/engine/session.js");
    const adapter = new MockAdapter(DEMO_APP);
    expect((adapter as { lastWaitMs?: unknown }).lastWaitMs).toBeUndefined();

    const result = await new EveSession({
      adapter,
      startUrl: "mock:",
      persona: "first-time-user",
      seed: 3,
      maxSteps: 6,
      screenshots: false,
      deterministic: true,
    }).run();
    expect(result.usage.durationMs).toBeGreaterThan(0);
  }, 30_000);
});
