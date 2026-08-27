/**
 * Conversation quality — what actually happened in the dialogue.
 *
 * The session loop records what the operator *did*: what they asked, where
 * they rephrased, whether they left. This is the other half — the judgment a
 * person forms about the thing they were talking to.
 *
 * The failure modes measured here are the ones people describe when they
 * complain about a bot, and none of them are visible to a functional test of
 * that bot. It answered a different question. It asked for something I'd
 * already told it. It never once admitted it was lost. There was no way to
 * reach a person. It took nine seconds to say nothing.
 *
 * Pure and deterministic: the same transcript and persona always produce the
 * same analysis, so it can be asserted on in tests and diffed across builds.
 */

import type { ConversationTurn } from "../core/kernel.js";
import { clamp01 } from "../core/random.js";
import type { Finding } from "../core/types.js";
import type { Persona } from "../personas/persona.js";
import { contentWords, isNearMiss } from "./overlap.js";
import type { ClassifiedTurn, ConversationKind } from "./types.js";
import { offersHandoff, turnWordCount } from "./types.js";

/* ------------------------------------------------------------------ */
/* Thresholds — each one a claim about how people talk                 */
/* ------------------------------------------------------------------ */

/** Past two rephrases of the same intent, people stop believing it will work. */
const REPAIR_TOLERANCE = 2;
/** A chat reply past this is a wall of text in a medium built for turns. */
const OVERLONG_REPLY_WORDS = 120;
/** Silence past this without a progress signal reads as "it's broken". */
const DEAD_AIR_MS = 5_000;
/** A support conversation that takes more turns than this has failed to route. */
const SUPPORT_TURN_BUDGET = 8;

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

export interface ConversationAnalysis {
  readonly address: string;
  readonly kind: ConversationKind;
  readonly persona: string;
  /** 0..100 — did it understand what was asked, across the conversation. */
  readonly understanding: number;
  /** 0..100 — did it show it understood, and remember what it was told. */
  readonly grounding: number;
  /** 0..100 — what happened when it failed: a route out, or a wall. */
  readonly recovery: number;
  readonly turnCount: number;
  readonly operatorTurns: number;
  /** Times the operator had to say the same thing again. */
  readonly repairAttempts: number;
  /** Replies where the surface admitted it did not understand. */
  readonly admittedMisses: number;
  /** Replies that answered something else without admitting anything. */
  readonly silentMisses: number;
  readonly everOfferedHandoff: boolean;
  readonly meanLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
  readonly findings: readonly Omit<Finding, "id" | "timestamp">[];
}

export interface AnalyzeConversationInput {
  readonly address: string;
  readonly kind: ConversationKind;
  /**
   * The transcript, carrying the surface's own classification where the
   * backend supplied one. Plain {@link ConversationTurn}s are accepted and
   * fall back to reading the wording.
   */
  readonly turns: readonly (ConversationTurn | ClassifiedTurn)[];
  readonly repairAttempts: number;
  readonly persona: Persona;
  /** Whether the operator ended up with what they came for. */
  readonly goalAchieved: boolean;
  readonly goal: string;
}

export function analyzeConversation(input: AnalyzeConversationInput): ConversationAnalysis {
  const { turns, persona, address, kind } = input;
  const surfaceTurns = turns.filter((turn) => turn.speaker === "surface");
  const operatorTurns = turns.filter((turn) => turn.speaker === "operator");

  const admittedMisses = surfaceTurns.filter(saidItDidNotUnderstand).length;
  const silentMisses = countSilentMisses(turns);
  const everOfferedHandoff = surfaceTurns.some((turn) =>
    offersHandoff({ text: turn.text, affordances: affordancesOf(turn) }),
  );

  const latencies = surfaceTurns
    .map((turn) => turn.latencyMs)
    .filter((ms): ms is number => typeof ms === "number");
  const meanLatencyMs = latencies.length
    ? Math.round(latencies.reduce((total, ms) => total + ms, 0) / latencies.length)
    : null;
  const maxLatencyMs = latencies.length ? Math.max(...latencies) : null;

  const asked = Math.max(operatorTurns.length, 1);
  // Understanding: every miss costs, and a silent miss costs more — the
  // operator spends a turn discovering it, and trusts the next answer less.
  const understanding = clamp01(
    1 - (admittedMisses * 0.6 + silentMisses) / asked - input.repairAttempts * 0.1,
  );
  const grounding = clamp01(1 - silentMisses / asked - amnesiaCount(turns) * 0.25);
  // Recovery is "what happened when it failed", so a conversation that never
  // failed has nothing to recover from and scores full marks. When it did
  // fail, three things are worth credit — and admitting the miss is worth
  // credit *over* bluffing, which the previous formula had exactly backwards:
  // it scored an honest bot below an evasive one on identical transcripts.
  const failures = admittedMisses + silentMisses;
  const recovery =
    failures === 0 && input.repairAttempts === 0
      ? 1
      : clamp01(
          (everOfferedHandoff ? 0.5 : 0) +
            (failures > 0 ? (admittedMisses / failures) * 0.3 : 0.3) +
            (input.goalAchieved ? 0.2 : 0),
        );

  return {
    address,
    kind,
    persona: persona.name,
    understanding: Math.round(understanding * 100),
    grounding: Math.round(grounding * 100),
    recovery: Math.round(recovery * 100),
    turnCount: turns.length,
    operatorTurns: operatorTurns.length,
    repairAttempts: input.repairAttempts,
    admittedMisses,
    silentMisses,
    everOfferedHandoff,
    meanLatencyMs,
    maxLatencyMs,
    findings: collectFindings(input, {
      admittedMisses,
      silentMisses,
      everOfferedHandoff,
      maxLatencyMs,
    }),
  };
}

function collectFindings(
  input: AnalyzeConversationInput,
  observed: {
    admittedMisses: number;
    silentMisses: number;
    everOfferedHandoff: boolean;
    maxLatencyMs: number | null;
  },
): readonly Omit<Finding, "id" | "timestamp">[] {
  const findings: Omit<Finding, "id" | "timestamp">[] = [];
  const url = input.address;
  const { turns, persona } = input;
  const surfaceTurns = turns.filter((turn) => turn.speaker === "surface");

  /* ---- it kept missing the same intent ------------------------------ */
  if (input.repairAttempts > REPAIR_TOLERANCE) {
    findings.push({
      severity: "critical",
      category: "conversation.understanding",
      title: `${persona.name} had to rephrase ${input.repairAttempts} times and was still not understood`,
      description:
        "Every rephrase is the person doing the work the surface failed to do, and each one costs more patience than the last. Past two attempts most people stop believing the next phrasing will land and leave — often for a channel that costs far more to serve.",
      evidence: repairEvidence(turns),
      url,
      recommendation:
        "Look at what they actually typed. If a real intent is missing, add it; if it exists but is not matching, the routing is the bug — not the phrasing.",
    });
  }

  /* ---- it answered something else, confidently ---------------------- */
  if (observed.silentMisses > 0) {
    findings.push({
      severity: observed.silentMisses >= 2 ? "major" : "minor",
      category: "conversation.grounding",
      title: `${observed.silentMisses} reply(ies) answered a different question without saying so`,
      description:
        "This is worse than admitting the miss. A confident answer to a nearby question reads as an answer, so the person acts on it, or spends a turn working out that it was not one. Either way they trust the next reply less.",
      evidence: silentMissEvidence(turns),
      url,
      recommendation:
        'Say when confidence is low. "I\'m not sure I follow — did you mean X?" costs one turn; a confident near-miss costs the conversation.',
    });
  }

  /* ---- no way to a person -------------------------------------------- */
  const struggled = input.repairAttempts > 0 || observed.admittedMisses > 0;
  if (struggled && !observed.everOfferedHandoff) {
    findings.push({
      severity: input.kind === "support" ? "critical" : "major",
      category: "conversation.recovery",
      title: "No route to a person, in a conversation that was already failing",
      description:
        "The surface did not understand and never offered a way out. A person who cannot get through and cannot escape does not try harder — they leave, and the cost of the contact lands somewhere more expensive anyway.",
      evidence: [
        `${turns.length} turn(s), ${input.repairAttempts} repair attempt(s), no handoff offered`,
        ...surfaceTurns.slice(-1).map((turn) => `last reply: ${truncate(turn.text)}`),
      ],
      url,
      recommendation:
        "Offer a person after the second failed attempt, unprompted. Waiting for someone to ask assumes they will, and by then they have gone.",
    });
  }

  /* ---- it forgot what it was told ------------------------------------ */
  const amnesia = amnesiaEvidence(turns);
  if (amnesia.length > 0) {
    findings.push({
      severity: "major",
      category: "conversation.grounding",
      title: `Asked for information the person had already given (${amnesia.length}×)`,
      description:
        "Being asked to repeat yourself is the clearest possible signal that nothing is listening. It converts a conversation into a form, and a badly designed one.",
      evidence: amnesia,
      url,
      recommendation:
        "Carry what has been said forward, and reflect it back rather than re-asking.",
    });
  }

  /* ---- dead air ------------------------------------------------------- */
  if (observed.maxLatencyMs !== null && observed.maxLatencyMs > DEAD_AIR_MS) {
    const slow = surfaceTurns.filter((turn) => (turn.latencyMs ?? 0) > DEAD_AIR_MS);
    findings.push({
      severity: observed.maxLatencyMs > DEAD_AIR_MS * 3 ? "major" : "minor",
      category: "conversation.responsiveness",
      title: `${slow.length} reply(ies) took longer than ${DEAD_AIR_MS / 1000}s`,
      description:
        "In a medium that looks like talking to someone, silence reads as being ignored rather than as work in progress. Without a visible sign it is still going, people re-send, refresh, or leave.",
      evidence: slow
        .slice(0, 3)
        .map(
          (turn) =>
            `${Math.round((turn.latencyMs ?? 0) / 100) / 10}s before: ${truncate(turn.text, 70)}`,
        ),
      url,
      recommendation:
        "Show that it is working, and say what it is doing. A visible 'checking your orders…' buys far more patience than a spinner.",
    });
  }

  /* ---- wall of text in a turn-taking medium --------------------------- */
  const overlong = surfaceTurns.filter((turn) => turnWordCount(turn.text) > OVERLONG_REPLY_WORDS);
  if (overlong.length > 0) {
    findings.push({
      severity: "minor",
      category: "conversation.understanding",
      title: `${overlong.length} reply(ies) run past ${OVERLONG_REPLY_WORDS} words`,
      description:
        "A chat window is read at the pace of speech, not of a document. Past a screenful people skim for the one line that matters and miss it, then ask again.",
      evidence: overlong
        .slice(0, 3)
        .map((turn) => `${turnWordCount(turn.text)} words: ${truncate(turn.text, 80)}`),
      url,
      recommendation: "Lead with the answer in one line; offer the detail as a follow-up.",
    });
  }

  /* ---- genre expectations --------------------------------------------- */
  if (input.kind === "support" && turns.length > SUPPORT_TURN_BUDGET && !input.goalAchieved) {
    findings.push({
      severity: "major",
      category: "conversation.recovery",
      title: `Took ${turns.length} turns without resolving "${input.goal}"`,
      description:
        "A support conversation is judged on how fast it routes, not on how long it can keep going. Every extra turn is a person deciding whether this is still worth their time.",
      evidence: [`${turns.length} turns, goal ${input.goalAchieved ? "achieved" : "not achieved"}`],
      url,
      recommendation:
        "Route to the right answer or the right person within a few turns; there is no prize for staying in the conversation.",
    });
  }

  return findings;
}

/* ------------------------------------------------------------------ */
/* Reading the transcript                                              */
/* ------------------------------------------------------------------ */

const ADMITTED_MISS =
  /\b(?:didn'?t|did not|don'?t|do not)\s+(?:quite\s+)?(?:understand|catch|get|follow)\b|\b(?:could|can) you (?:please )?(?:rephrase|clarify|try again)\b|\bnot sure i (?:understand|follow)\b/i;

/** Phrasings that ask for something, used to spot a re-ask. */
const ASKS_FOR =
  /\b(?:what(?:'s| is)? your|can you (?:give|provide|confirm|tell me)|please (?:provide|share|confirm|enter)|could you (?:give|provide|confirm))\b[^.?!]{0,60}/gi;

function admittedMiss(text: string): boolean {
  return ADMITTED_MISS.test(text);
}

/**
 * Did the surface say it did not understand?
 *
 * The backend's own flag wins where it exists — a scripted fallback intent
 * or an API no-match signal is the surface admitting the miss, whatever
 * words it dressed the admission in. Only when nothing was declared does
 * this fall back to reading the wording.
 */
function saidItDidNotUnderstand(turn: ConversationTurn | ClassifiedTurn): boolean {
  if ("notUnderstood" in turn && typeof turn.notUnderstood === "boolean") {
    return turn.notUnderstood;
  }
  return admittedMiss(turn.text);
}

function affordancesOf(
  turn: ConversationTurn,
): readonly { id: string; kind: "suggestion" | "handoff" | "action"; label: string }[] | undefined {
  const detail = turn.detail?.affordances;
  return Array.isArray(detail)
    ? (detail as { id: string; kind: "suggestion" | "handoff" | "action"; label: string }[])
    : undefined;
}

/**
 * Replies that answered a different question without saying so.
 *
 * Mirrors the adapter's live check so the report and the operator's
 * experience agree: a fluent reply that shares almost none of the asker's
 * vocabulary. Conservative by design — short replies and replies that echo
 * the question are never counted.
 */
function countSilentMisses(turns: readonly (ConversationTurn | ClassifiedTurn)[]): number {
  let count = 0;
  for (let i = 1; i < turns.length; i++) {
    const reply = turns[i];
    const asked = turns[i - 1];
    if (!reply || !asked) continue;
    if (reply.speaker !== "surface" || asked.speaker !== "operator") continue;
    if (saidItDidNotUnderstand(reply)) continue;
    if (isNearMiss(asked.text, reply.text)) count += 1;
  }
  return count;
}

function silentMissEvidence(turns: readonly (ConversationTurn | ClassifiedTurn)[]): string[] {
  const evidence: string[] = [];
  for (let i = 1; i < turns.length && evidence.length < 3; i++) {
    const reply = turns[i];
    const asked = turns[i - 1];
    if (!reply || !asked) continue;
    if (reply.speaker !== "surface" || asked.speaker !== "operator") continue;
    if (saidItDidNotUnderstand(reply)) continue;
    if (isNearMiss(asked.text, reply.text)) {
      evidence.push(`asked: "${truncate(asked.text, 60)}" → got: "${truncate(reply.text, 90)}"`);
    }
  }
  return evidence;
}

/** Times the surface asked for something the operator had already said. */
function amnesiaCount(turns: readonly ConversationTurn[]): number {
  return amnesiaEvidence(turns).length;
}

function amnesiaEvidence(turns: readonly ConversationTurn[]): string[] {
  const evidence: string[] = [];
  const saidSoFar: string[] = [];

  for (const turn of turns) {
    if (turn.speaker === "operator") {
      saidSoFar.push(turn.text.toLowerCase());
      continue;
    }
    for (const request of turn.text.match(ASKS_FOR) ?? []) {
      const wanted = contentWords(request);
      if (wanted.size === 0) continue;
      // Already given if an earlier operator turn covered the same ground.
      const covered = saidSoFar.some((said) => {
        const words = contentWords(said);
        let shared = 0;
        for (const word of wanted) if (words.has(word)) shared += 1;
        return wanted.size > 0 && shared / wanted.size >= 0.6;
      });
      if (covered && evidence.length < 4) {
        evidence.push(`asked again for: "${truncate(request.trim(), 70)}"`);
      }
    }
  }
  return evidence;
}

function repairEvidence(turns: readonly ConversationTurn[]): string[] {
  return turns
    .filter((turn) => turn.speaker === "operator")
    .slice(0, 5)
    .map((turn, index) => `attempt ${index + 1}: "${truncate(turn.text, 80)}"`);
}

function truncate(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
