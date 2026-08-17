# MCP Server Evaluation

> **Phase 2 note:** the adapter is now **kernel-native**. The projection
> model in §1 below describes the *deprecated web view* — kept for
> pre-kernel consumers. The native model: one `mcp.invoke` action per
> `tools/call` with typed arguments, a structured catalog with stable
> `tool:<name>` affordance identity (schemas + annotations preserved), and
> typed signals (`tool-result` full-text with explicit truncation, `error`
> by source, `notification`, `surface-terminated`). See `docs/kernel.md`;
> retired strains: `docs/projection-debt-ledger.md`.

EVE can evaluate arbitrary MCP servers two ways:

1. **Persona-driven exploration** — the `McpAdapter` projects a server onto
   the textual-surface seam, so any persona can operate it through the
   normal session loop (`eve run mcp:…`).
2. **Deterministic evaluation** — the tier-1 oracle suite
   (`eve mcp-eval` / `evaluateMcpServer`) checks schema quality, protocol
   conformance, and robustness under fuzzed inputs, and produces an
   evidence-backed report with three `mcp.*` scores.

Both speak MCP natively through the official SDK (already a runtime
dependency — EVE itself is an MCP server). Stdio is the primary transport;
Streamable HTTP is supported for already-running servers.

---

## 1. The projection model (how an MCP server becomes a surface)

Spec 2 of `docs/superpowers/specs/2026-07-26-non-visual-surface-adapters-design.md`,
implemented as Approach C (capability-flagged projection):

| Surface concept | MCP projection |
| --- | --- |
| the page | the server's tool catalog |
| affordance menu | `tools/list` — each tool is a menu item |
| a form | a tool's JSON Schema — each property is a text field |
| clicking a link | selecting a tool (opens its "form") |
| submitting a form | `tools/call` with the filled arguments |
| the next page | the tool result, rendered as text |
| a modal dialog | a tool-level or protocol error |
| a notice | `notifications/tools/list_changed` (menu refreshes live) |

The adapter declares `TEXTUAL_SURFACE` (`spatial: false`,
`canScreenshot: false`, `canGoBack: false`), so the Phase-0 honesty gate
skips all pixel-derived checks — no vision findings can fire on this
surface. Every strained mapping is logged in
`docs/projection-debt-ledger.md` (a required Phase-1 deliverable that sizes
the Phase-2 core generalization).

## 2. Persona-driven exploration

```bash
# Operate a local MCP server as a simulated user
eve run "mcp:node my-server.js --flag" --persona curious-explorer --goal "look up a customer"

# A running HTTP server works too
eve run "mcp:http://localhost:3001/mcp" --goal "add two numbers"
```

The persona sees the tool menu, picks a tool that matches its goal, fills
the schema-projected fields (typed values are coerced to schema types;
unparseable input is sent raw so servers can be observed rejecting it), and
reads the result. Patience, confusion, abandonment, expectation violations
and the full scoring/reporting pipeline work unmodified.

Programmatic use:

```ts
import { EveSession, McpAdapter } from "experience-validation-engine";

const session = new EveSession({
  adapter: new McpAdapter(), // stdio by default; options: { connector, windowRows, callTimeoutMs }
  startUrl: "mcp:node my-server.js",
  persona: "curious-explorer",
  goal: "add two numbers",
  seed: 42,
});
const result = await session.run();
```

## 3. Deterministic evaluation (tier-1 oracles)

```bash
eve mcp-eval "node my-server.js"            # schema + conformance + fuzzing
eve mcp-eval "node my-server.js" --no-fuzz  # schema + conformance only
eve mcp-eval "node my-server.js" --format json --seed 7 --timeout 3000
```

Exit code is 1 when any finding is critical (e.g. a fuzz crash) — CI-gate
friendly, following the `mcp-evals` pattern.

| Oracle | What it checks | Dimension |
| --- | --- | --- |
| Schema (`checkToolSchemas`) | inputSchema is an object schema; `required` ⊆ `properties`; properties are describable; description presence/quality; annotation honesty (`delete_*` vs `destructiveHint`, `get_*` vs `readOnlyHint`) | `mcp.schemaQuality` |
| Conformance (`checkConformance`) | initialize handshake + serverInfo; `capabilities.tools` declaration; ping; unknown tool → JSON-RPC protocol error (not fake success, not crash) | `mcp.conformance` |
| Fuzz (`fuzzTools`) | seeded adversarial inputs per tool — missing required, type violations, boundary values, oversized payload — classified as protocol-error / error-result / accepted-invalid / hang / crash | `mcp.robustness` |

Scoring follows the scorer's philosophy (derived measurements, never
vibes): each dimension starts at 100 and is deducted per finding severity
(critical 25 / major 12 / minor 4 / info 1 — the session scorer's
schedule), with the driving findings cited as evidence.

Programmatic use:

```ts
import { evaluateMcpServer } from "experience-validation-engine";

const report = await evaluateMcpServer("node my-server.js", {
  fuzz: { seed: 7, timeoutMs: 3000 },
});
// report: { server, toolCount, listChanged, findings, scores, fuzz, durationMs }
```

In-process servers (tests, dogfooding — EVE can evaluate *itself*):

```ts
import { connectMcpInProcess, evaluateMcpServer } from "experience-validation-engine";
import { createServer } from "experience-validation-engine/mcp";

const report = await evaluateMcpServer("eve-itself", {
  connector: (target) => connectMcpInProcess(createServer(), target),
});
```

## 4. Registered vocabulary (Phase-0 registries)

`evaluateMcpServer` calls `registerMcpVocabulary()` (idempotent), which
registers via the Phase-0 registries:

- **Dimensions** `mcp.schemaQuality`, `mcp.robustness`, `mcp.conformance` —
  `appliesTo: ["textual"]`, weight 0 (reported, never reweights existing
  composites), `evidenceRequired: true`.
- **Finding categories** `mcp.schema-quality`, `mcp.robustness`,
  `mcp.conformance` — `appliesTo: ["textual"]`.
- **Action verb** `mcp.invoke` — engine-side only, `onCp1Wire: false`
  (widening the canonical CP/1 verb set is a protocol version change, not a
  registration).

## 5. Boundaries and non-goals (Phase 1)

- **No LLM-judge tiers.** Description-fidelity judging ("does the tool do
  what its description claims") and BFCL-style executable verification are
  later-phase tiers ([J]/[X] in the oracle architecture).
- **No core generalization.** `Percept`/`Action` are untouched; the
  projection debt is logged in `docs/projection-debt-ledger.md` instead of
  being silently absorbed.
- **Fuzzing is an evaluator, not a persona.** It probes the connection
  directly and never influences persona sessions; the formal active-probe
  extension point is Phase-2/7 work (ledger entry 8).
- **Elicitation, resources, prompts, sampling** are not projected yet —
  `tools/*` only.
