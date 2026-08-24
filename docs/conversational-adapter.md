# The Conversational Adapter — EVE talks

> **What it adds:** EVE could drive software, and (since the humanity seam)
> read what software produces. It could not have a conversation. This adds
> the third relationship: a surface that **answers back** — a support bot, an
> LLM copilot, a voice assistant, the "ask me anything" box that has quietly
> become the front door of a lot of products.

A conversation is not a document delivered in pieces, and modelling it as one
loses everything that matters about it. Three things make it its own thing:

- **There is no back button.** A misunderstanding cannot be undone, only
  talked past. That single fact is why being misread is expensive here and
  cheap everywhere else.
- **The operator waits**, without knowing whether anything is happening. In a
  medium that looks like talking to a person, silence reads as being ignored,
  not as work in progress.
- **It is the only surface that can fail to understand *them*.** Every other
  modality fails in one direction — the operator does not understand the
  surface. Here it runs both ways, and the reply puts a decision in front of
  the person no other modality does: rephrase, or leave?

```
$ eve chat mock: --goal "get a refund for being charged twice" --seed 3

  #0 chat.say "get a refund for being charged twice" — Asking about what I came for.
  #1 chat.rephrase "Sorry — what I mean is: get a refund for being charged twice"
     — That answered something I didn't ask. Let me try putting it another way.
  #2 chat.rephrase "Let me put it another way — I need to get a refund for being charged twice."
     — That answered something I didn't ask. Let me try putting it another way.
  #3 give up: It never understood "get a refund for being charged twice", and
     there is no way to reach a person.

  ────────────────────────────────────────────────
  Conversation             : support, 7 turn(s), asked 3 time(s)
  Understood the person    : 0/100 (3 silent miss(es), 0 admitted)
  Showed it understood     : 0/100
  Recovered when it failed : 40/100 (never offered a person)
  Had to rephrase          : 2×
  Outcome                  : abandoned
```

That is the built-in demo bot, and it is deliberately a *plausible* one
rather than an obviously broken one: it greets well, handles its happy path,
and is confidently unhelpful everywhere else. The operator asks about a
double charge; it hears "charge" and answers about the billing cycle. Nobody
ever says "I didn't understand".

---

## 1. The `"conversational"` modality

```ts
type KernelPercept =
  | { modality: "visual";   viewport; scrollY; scrollHeight; screenshot; …base }
  | { modality: "textual";  lines; windowRows; scrollLine; …base }
  | { modality: "document"; blocks; section; sectionCount; …base }
  | { modality: "conversational";                                       // ← new
      turns; recallWindow; awaitingReply; lastLatencyMs; repairAttempts; …base }
```

| Kernel concept | What dialogue needed |
| --- | --- |
| `AffordanceLocator` | `{ kind: "turn", index }` — a chip is "in the reply three turns ago", not at a pixel or a cell |
| `SurfaceSignal` | `not-understood`, with a `confident` flag — see below |
| `Modality` | `"conversational"` joins `ALL_MODALITIES`, so every entry that applied to "all modalities" still does |

`CONVERSATIONAL_SURFACE` declares `spatial: false` (nothing to screenshot,
no pointer) and — pointedly — `canGoBack: false`.

### The `confident` flag is the whole point

```ts
{ type: "not-understood"; text: string; confident: boolean }
```

`confident: false` — the surface *said* it was lost ("sorry, could you
rephrase?"). The person knows where they stand and tries again.

`confident: true` — the surface said nothing and answered a nearby question
fluently. This is worse, and it is the thing users actually complain about.
They act on the answer, or spend a turn working out it was not one, and they
trust the next reply less either way.

## 2. Backends

One method: given what the operator said, what comes back and how long did it
take. Turn history, repair counting and recall belong to the adapter, not the
transport.

| Backend | For |
| --- | --- |
| `ScriptedBackend` | Tests, `eve chat mock:`, and real scripted/IVR flows — a rule list *is* what those bots are |
| `HttpBackend` | Any chat endpoint. Body template with `{{message}}`, reply extracted by dotted path, ~12 common shapes tried by default |

Latency from `HttpBackend` is **measured, not modelled** — one of the few
places EVE observes a real duration rather than simulating one, and a large
part of how a bot feels.

## 3. Talking is its own cascade

`HeuristicCognition` gains a conversational branch that fires only on a
conversational kernel, so every existing surface is untouched.

1. It's still typing → wait, patience permitting.
2. It's gone → nothing left to talk to.
3. I've had enough → leave.
4. **It didn't get me → say it differently**, while I still have the will.
5. I've rephrased too many times → ask for a human.
6. It won't help but offered a way out → take it.
7. Nothing said yet → open with what I came for.
8. It answered → follow up on what's missing.

Two details that decide whether the model is believable:

**Nobody leaves on the first miss.** Being misread once reads as bad luck,
not as a broken surface. The give-up branch only opens after a repair has
already failed — before that fix, a third of seeds walked away instantly.

**Rephrasing degrades the way people's does.** First they explain
("Sorry — what I mean is…"), then they simplify, then they type keywords with
no sentence at all — which is what someone does when they have given up on
being understood as a person.

```ts
persistence = (patience × 0.5 + resilience × 0.5) × (1 − repairAttempts × 0.3)
```

## 4. What gets measured

Four registered, conversation-only dimensions, each fed by its own finding
category through the scorer's generic rule:

| Dimension | Measures |
| --- | --- |
| `conversation.understanding` | Did it understand what was asked — first time, and after they tried again |
| `conversation.grounding` | Did it show it understood, and carry the conversation forward |
| `conversation.recovery` | What happened when it failed: an admission, a route to a person |
| `conversation.responsiveness` | Did replies arrive before silence read as being ignored |

Findings: repeated rephrasing, confident near-misses, no route to a person in
a conversation already failing, being asked for something already given, dead
air, wall-of-text replies, and a support conversation that ran long without
resolving.

### Judging whether a reply engaged with the question

The load-bearing comparison, and the one place a bug is most costly — a
detector that calls good bots bad destroys trust in the whole tool. Two
lessons are baked into `overlap.ts`:

**Stem before comparing.** "get a refund for being charged twice" answered
with "I've refunded the duplicate charge" shares no *literal* word:
refund/refunded and charged/charge are different strings. Comparing raw
tokens scored a perfect reply as a near-miss. The bare `"e"` suffix matters
too — without it `charges → charg` while `charge → charge`, and the family
never unifies.

**"Too short to judge" means words, not stems.** A normal 25-word paragraph
reduces to five or six distinct stems; gating on stem count silently exempted
exactly the fluent near-misses the check exists to catch.

Both directions are guarded: replies under 12 words are never judged (they
are not attempts at an answer), and questions with under two content words
are never judged (there is nothing to miss).

## 5. Usage

```bash
eve chat mock: --goal "get a refund for being charged twice"
eve chat https://api.example.com/chat --goal "reset my password" --success "sent,email"
eve chat https://api.example.com/v1/chat --reply-path choices.0.message.content \
  --header "authorization: Bearer $TOKEN" --persona impatient-user
```

```ts
import { converse, ScriptedBackend, HttpBackend } from "experience-validation-engine";

const result = await converse(new HttpBackend({ url: "https://…/chat" }), {
  persona: "elderly-user",
  goal: "cancel my subscription",
  goalSuccessSignals: ["cancelled"],
});

result.conversation.understanding;   // 0..100
result.conversation.silentMisses;    // answered something else, without saying so
result.conversation.everOfferedHandoff;
result.endReason;                    // "goal-achieved" | "abandoned" | …
result.transcript;                   // every turn, both sides
```

The `eve_evaluate_conversation` MCP tool exposes the same thing, so an agent
can evaluate another product's conversational UX. `eve chat` exits non-zero
on a critical finding, so it gates a bot in CI the way `eve run` gates an app.

## 6. Where the perception boundary sits

Unchanged. The operator perceives what the surface says and what it offers
alongside — suggested replies, a handoff, a citation. Not its prompt, not its
confidence scores, not its intent classification. A user of a support bot
sees none of those either.

## 7. Files

| Path | What lives there |
| --- | --- |
| `src/conversation/types.ts` | The dialogue model and non-answer recognition |
| `src/conversation/overlap.ts` | Did the reply engage with the question (stemming, near-miss) |
| `src/conversation/backends/` | Scripted (+ the demo bot) and HTTP |
| `src/conversation/adapter.ts` | `ConversationAdapter` — kernel-native conversational surface |
| `src/conversation/analysis.ts` | Understanding, grounding, recovery, and the findings |
| `src/conversation/converse.ts` | `converse` — the conversation session |
| `src/conversation/vocabulary.ts` | The `conversation.*` registrations |
| `src/conversation/report.ts` | The conversation report (verdict + marked-up transcript) |
