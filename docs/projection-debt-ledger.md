# Projection Debt Ledger

**Phase:** 2 — **Approach B landed** (modality-variant kernel,
`src/core/kernel.ts`). Entries 1–7 are **retired**; entry 8 remains and is
deferred to the production-software phase (privileged-probe channel).
**Purpose:** Every place the MCP projection strained the browser-flavored
`Percept`/`Action` contract, logged as it was made — and, below each entry,
the first-class home it got in the kernel.

See `docs/kernel.md` for the Phase-2 kernel design and migration notes.

---

## Ledger entries

### 1. A tool call is projected as "form fill + Enter" — the action never names what it is
> **Status: RETIRED in Phase 2.** `Action` gained an `invoke` variant (`{ kind: "invoke", verb, payload }`); cognition emits a single `mcp.invoke` with typed arguments and the session executes it through `KernelSurface.actKernel` — one `tools/call` is one action. Evidence chains read `invoke add({"a":2})`.

**Where:** `src/surface/mcp.ts` (`invokeSelected`), session `execute()` (`src/engine/session.ts`).
**Strain:** The browser action vocabulary (`click`/`type`/`press`/`scroll`…)
has no "invoke a tool with structured arguments". The projection decomposes
one semantic act (`tools/call {name, args}`) into N synthetic UI acts (focus
field → type text → press Enter). Downstream consumers (loop journal,
CP/1 `Experience` documents, workflow graph, scoring evidence) see a form
submission, not a tool call. The registered `mcp.invoke` verb exists in the
action-verb registry but cannot appear in `Action` without widening the core
union — it is metadata waiting for Phase 2.
**Loss:** evidence chains say `type "2" into "a"` rather than
`invoke add({a: 2})`; argument-level reasoning (which *argument* caused a
failure) must be reconstructed from the frame text.
**Phase-2 fix:** `Action = { verb: "mcp.invoke", target, payload }` with
per-surface verb registries, as sketched in synthesis §1.2. **Cost: 3–5 days**
(includes collapsing the synthetic keystrokes out of journals/reports).

### 2. The tool catalog is projected as lines of text with character-cell geometry
> **Status: RETIRED in Phase 2.** Kernel `Affordance { id: "tool:<name>", kind: "mcp.tool", locator: { schemaPath } }` with schema + annotations in perceived metadata. Identity is by name, stable across `list_changed`.

**Where:** `src/surface/mcp.ts` (`buildFrame`), `src/surface/textFrame.ts`.
**Strain:** `tools/list` returns structured data (name, description, JSON
Schema, annotations). The projection renders it to text lines and re-detects
affordances by line number — a lossy round trip: structured → text → boxes →
`VisibleElement`. Annotations (`readOnlyHint` etc.) are currently dropped
from the rendered frame entirely because there is no honest place to put
them in `VisibleElement` (they are not *visible text* a human reads).
**Loss:** annotation metadata is invisible to cognition during persona
exploration (the deterministic schema oracle sees it, the persona does not);
element identity is positional (line numbers), so a `list_changed` refresh
shifts every element's identity.
**Phase-2 fix:** `Affordance { id, kind, locator, description, state }` with
`locator: { schemaPath }` and a metadata bag for hints. **Cost: 2–3 days.**

### 3. Tool results (and errors) are projected as text frames + a fake "dialog"
> **Status: RETIRED in Phase 2.** Typed `SurfaceSignal`s: `tool-result` (full text, explicit `truncated` flag), `error` (`source: tool | protocol | surface`), `notification`. The fake dialog survives only in the deprecated web view.

**Where:** `src/surface/mcp.ts` (`lastResult`, `snapshot().dialogs`).
**Strain:** A tool result is an *event*, not a screen region. The projection
appends it to the frame as lines (fine) and maps an error result onto
`VisibleDialog` (strained): dialogs in the browser model are modal overlays
blocking the page; a tool error blocks nothing — the menu is still there.
Cognition's dialog handling ("dismiss the modal") is semantically wrong for
"your call failed, read why".
**Loss:** error results, protocol errors, and server notifications are three
different things forced through one "dialog" metaphor; result structure
(tables, JSON, multi-part content) is flattened to truncated text
(`MAX_RESULT_LINES`), so large results are lossy for cognition.
**Phase-2 fix:** first-class `SurfaceSignal[]` (`tool-result`, `error`,
`notification`) with typed payloads, per synthesis §1.2. **Cost: 2–4 days.**

### 4. Argument typing is projected through free-text typing + coercion
> **Status: RETIRED in Phase 2.** Argument intent is cognition-side: `synthesizeArguments` (`src/cognition/toolArgs.ts`) produces schema-typed values; the adapter actuates without coercion.

**Where:** `src/surface/mcp.ts` (`typeText`, `coerceArgument`).
**Strain:** JSON Schema types (number, boolean, object, enum, nested) are
funneled through a single text channel: the persona types characters, the
adapter re-parses them against the schema. Unparseable input is sent raw —
deliberately, so servers can be observed rejecting garbage — but this means
"the operator typed badly" and "the operator probed an edge case" are
indistinguishable downstream.
**Loss:** no way to express structured argument intent (arrays, nested
objects, null); coercion failures conflate persona error with probe intent.
**Phase-2 fix:** payload-carrying actions (entry 1) make coercion a
cognition-side decision, not an adapter guess. **Cost: 1–2 days** (folds
into entry 1).

### 5. Session identity/addressing: `url` and `title` carry server target and name
> **Status: RETIRED in Phase 2.** Kernel `FrameIdentity { address, label, surfaceState }`. In the web view, structural frame headers are marked `heading` so menu/form/result have distinct screen signatures — a successful call no longer scores as a dead click.

**Where:** `src/surface/mcp.ts` (`snapshot().url/title`).
**Strain:** `Percept.url` is the URL bar; here it is `mcp:<command line>` —
not a location an operator "is at", but a process they launched. `title` is
the server name. This mostly works (frame identity is genuinely
address + label), but `appIdForUrl`, workflow URL matching, and report
"group by page" logic inherit a metaphor where one "URL" = one whole server
plus a hidden state machine (menu/form/result) that has no address
representation at all.
**Loss:** the menu/form/result views are three perceptually distinct states
with one URL; revisit detection and screen signatures treat them as one
screen (mitigated: signatures include visible text, so they differ in
practice — but this is accidental, not designed).
**Phase-2 fix:** kernel `address` + `label` + explicit surface-state
identifier. **Cost: 1–2 days.**

### 6. "Session = one sitting" vs. server lifecycle
> **Status: RETIRED in Phase 2.** `surface-terminated` signal; the heuristic policy abandons honestly when the server dies mid-session.

**Where:** `McpAdapter.open/navigate/close`, `src/engine/session.ts` loop.
**Strain:** A browser page does not die mid-session; an MCP server can (the
fuzz oracle *makes* it die). The adapter degrades honestly (dead-end frame,
loadingIndicator off), and cognition reads that as a dead end — but the
session model has no concept of "the surface itself ceased to exist" vs.
"this screen has no affordances". `navigate()` re-connecting the whole
server is a much heavier operation than the name suggests.
**Loss:** crash-as-finding works for the oracle harness but is only
implicitly visible to persona sessions (dead end → abandonment).
**Phase-2 fix:** `SurfaceSignal: surface-terminated`; session policy for
terminal surfaces. **Cost: 1–2 days.**

### 7. Scoring: `mcp.*` dimensions live beside, not inside, the session scorer
> **Status: RETIRED in Phase 2.** The severity schedule lives once in `src/scoring/scorer.ts` (`FINDING_SEVERITY_PENALTY`, `scoreFromFindings`); `Finding.category`/`Score.dimension` are open (registry-backed) types; `mcp.*` dimensions flow through `computeScores` via `FindingCategoryEntry.scoresInto`, evidence-gated and modality-gated. `mcpEval/evaluate.ts` delegates.

**Where:** `src/mcpEval/evaluate.ts` (`scoreDimension`), `src/scoring/scorer.ts`.
**Strain:** The Phase-0 registries made dimensions/categories *registerable*,
but `Finding.category` and `Score.dimension` are still the closed unions at
type level, and `computeScores` computes the 16 built-ins by name. MCP
findings therefore cannot flow through the session scoring pipeline: the
harness scores its own dimensions with a parallel (deliberately identical)
penalty schedule. Two scoring implementations now exist.
**Loss:** duplication of the penalty schedule; persona-session findings and
oracle findings cannot yet composite into one report.
**Phase-2 fix:** registry-driven scorer (dimensions as data, penalty
schedule in one place). **Cost: 3–4 days** (touches every
`Record<ScoreDimension, …>` consumer — the known registry-ization debt).

### 8. Fuzzing runs outside the perception boundary, by design — document the exception
> **Status: REMAINS.** Still honest-by-design; the named active-probe/evaluator extension class is deferred to the production-software phase (privileged-probe channel), where the general case lands. Proliferation risk is contained: exactly one probe (the fuzz oracle) exists.

**Where:** `src/mcpEval/fuzzOracle.ts`.
**Strain:** The prime directive ("operators act only on what a human could
perceive") covers *personas*. The fuzz oracle is not a persona — it is an
active probe, the class of extension the audit flags as "active-probe
extension point" (§4.3 item 6). It acts directly on the connection, never
through cognition. This is honest but *adjacent* to the boundary, and every
future domain pack will want the same thing (Phase 7's privileged-probe
channel is the general case).
**Loss:** none today (findings are evidence-backed and the probe never
influences persona runs), but the pattern needs a named home before it
proliferates.
**Phase-2 fix:** formal active-probe/evaluator extension class, separate
from both plugins and adapters. **Cost: 2–3 days** (design + migration).

---

## Summary for Phase-2 scoping

| # | Entry | Est. cost | Phase-2 outcome |
|---|-------|-----------|-----------------|
| 1 | Tool call ≠ form fill (action vocabulary) | 3–5 d | **Retired** — `invoke` action + `KernelSurface.actKernel` |
| 2 | Structured catalog → text lines round trip | 2–3 d | **Retired** — kernel affordances, stable ids, annotations kept |
| 3 | Result/error as dialog (signal types) | 2–4 d | **Retired** — typed `SurfaceSignal`s, explicit truncation |
| 4 | Argument typing via text coercion | 1–2 d | **Retired** — `synthesizeArguments` (folded into 1) |
| 5 | URL/title addressing, surface state | 1–2 d | **Retired** — `FrameIdentity.surfaceState` + heading-marked web view |
| 6 | Server lifecycle vs. session model | 1–2 d | **Retired** — `surface-terminated` signal + abandon policy |
| 7 | Parallel scorer for registry dimensions | 3–4 d | **Retired** — one schedule, registry-driven generic rule |
| 8 | Active probes beside the boundary | 2–3 d | **Remains** — deferred to the privileged-probe phase |

## Phase-2 summary (what landing the kernel changed)

- **The kernel is additive, not a rewrite.** `src/core/kernel.ts` defines
  `KernelPercept` (discriminated over modality), `Affordance`,
  `SurfaceSignal`, `KernelAction`. The legacy `Percept`/`Action` shapes are
  the deprecated *web view*, projected both ways
  (`kernelFromWebPercept`, `webPerceptFromKernel`); all ~375 pre-existing
  tests passed unchanged before any test was added.
- **MCP is kernel-native.** `McpAdapter` implements `KernelSurface`;
  cognition decides on the real catalog; one `tools/call` = one
  `mcp.invoke`. The legacy click/type projection still works (deprecated,
  tested) — the persona cascade can still fall back to it once every tool
  has been tried; that tail is compatibility, not the native path.
- **Scoring is registry-driven and modality-gated.** Visual-only dimensions
  are skipped (not vacuously passed) on textual sessions; registered
  dimensions with evidence flow through the session scorer.
- **Wire impact: none.** `invoke` collapses to `click` in
  `ACTION_MAP` (additive); no canonical-form change, no cp2 needed.
- **Known limitation (documented, not a regression):** working-memory holds
  bound a persona to one call per tool per session by default; richer
  retry/compare strategies belong to the agent-operator phase.
