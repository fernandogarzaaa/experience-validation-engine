# The Modality-Variant Kernel (Phase 2)

**Status:** landed. Supersedes the Approach B/C fork in
`docs/superpowers/specs/2026-07-26-non-visual-surface-adapters-design.md` —
B was performed once, additively, after the MCP projection measured the
strain (`docs/projection-debt-ledger.md`).

## Design

`src/core/kernel.ts` names the five concepts downstream modules actually
consume, in a modality-agnostic form:

```ts
interface FrameIdentity { address: string; label: string; surfaceState?: string }

interface Affordance {
  id: string;                    // stable while the entity persists (tool:<name>)
  kind: string;                  // OPEN, registry-aligned — ARIA roles on web, "mcp.tool" on MCP
  locator:                       // bbox | charCell | schemaPath | readingOrder
    | { kind: "bbox"; box: BoundingBox }
    | { kind: "charCell"; line: number; column: number }
    | { kind: "schemaPath"; path: string }
    | { kind: "readingOrder"; section: number; block: number }   // document surfaces
    | { kind: "turn"; index: number };                           // conversational surfaces
  description: string;
  state: { enabled: boolean; editable?: boolean; metadata?: Record<string, unknown> };
}

type SurfaceSignal =             // typed — no fake "dialog" slot
  | { type: "dialog"; text }
  | { type: "loading"; active }
  | { type: "error"; text; source: "tool" | "protocol" | "surface" }
  | { type: "tool-result"; tool; isError; text; truncated }   // full text, explicit truncation
  | { type: "notification"; method }
  | { type: "await-input"; prompt }
  | { type: "surface-terminated"; reason }
  | { type: "end-of-content"; label }                          // a document ends
  | { type: "not-understood"; text; confident }                // the surface missed the *operator*
  | { type: "comprehension-gap"; text; gap: "term" | "reference" | "figure" | "quantity" | "structure" };

type KernelPercept =             // discriminated over modality
  | { modality: "visual"; viewport; scrollY; scrollHeight; screenshot; …base }  // docs/rendering.md
  | { modality: "textual"; lines; windowRows; scrollLine; …base }
  | { modality: "document"; blocks; section; sectionCount; sectionNoun;
                            totalBlocks; blocksRead; …base }    // see docs/humanity-adapter.md
  | { modality: "conversational"; turns; recallWindow; awaitingReply;
                            lastLatencyMs; repairAttempts; …base };  // docs/conversational-adapter.md

interface KernelAction { verb: string; target?: string; payload?: unknown }
```

The per-surface action vocabulary is declared in
`SurfaceCapabilities.actionVerbs` (`actionVerbsFor` defaults to the eleven
legacy web kinds); verbs are registered in `actionVerbRegistry` and stay
off the CP/1 wire unless the protocol version changes (SPEC §8).

## Compatibility: the deprecated web view

`Percept` and the eleven browser-flavored `Action` kinds are **kept** as the
deprecated `WebPerceptView` of the kernel:

- `kernelFromWebPercept(percept, modality)` — legacy → kernel (what
  cognition receives on pre-kernel adapters: browser, CLI, mock).
- `webPerceptFromKernel` / `webPerceptFromVisualKernel` — kernel → legacy
  (`src/surface/kernelView.ts`, `src/core/kernel.ts`).
- Kernel-native adapters implement `KernelSurface`
  (`kernelPercept()`, `actKernel(action)` in `src/browser/adapter.ts`) and
  derive their legacy snapshot from the same state, so old consumers keep
  working. `McpAdapter` is the first.
- `Action` gained one variant: `{ kind: "invoke"; verb; target; payload? }`,
  executed via `actKernel` — a single semantic act, never decomposed into
  synthetic gestures.

Session flow: the loop still runs on the legacy `Percept` (memory, workflow,
surprise, reporting untouched); cognition additionally receives
`CognitiveContext.kernel`. On web surfaces this is exactly the projection of
the decision percept — behavior-identical by construction and pinned by the
shim-equivalence test (`tests/kernel.test.ts`).

## Scoring: registry-driven, modality-gated

- `computeScores` accepts `modality`; dimensions whose registry `appliesTo`
  excludes it are **skipped, not failed** (the `overall` composite
  renormalizes weights automatically).
- `Finding.category` / `Score.dimension` are open, registry-backed types
  (`FindingCategoryId` / `ScoreDimensionId`).
- One severity schedule (`FINDING_SEVERITY_PENALTY`); the generic rule
  `scoreFromFindings` scores registered dimensions from findings in
  categories linked via `FindingCategoryEntry.scoresInto`, evidence-gated.
  The MCP harness's parallel scorer was retired onto it.

## Migration notes

- **Adapter authors:** implement `KernelSurface` to go native; nothing else
  is required of existing adapters.
- **Domain packs:** register dimensions/categories/verbs as in Phase 0, add
  `scoresInto` links for scoring, mint affordance kinds freely (open string).
- **Wire:** `invoke` collapses to `click` in CP/1 `Experience` documents
  (additive `ACTION_MAP` entry). Canonical form unchanged; no cp2.
