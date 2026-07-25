# Non-Visual Surface Adapters — Design

**Date:** 2026-07-26
**Status:** Proposed
**Scope:** Spec 1 of 3 (see [Roadmap](#roadmap))

## Problem

EVE validates *experience*, but today it can only perceive a browser. Headless
developer tools — a proxy, an MCP server, a CLI — have no browsable UI, so they
cannot be studied at all.

This is not a hypothetical gap. Running a real usability study against the Axiom
training dashboard exposed the failure mode from the other direction: because the
study target was a single non-interactive status card, EVE reported findings like
*"'live' is rendered at 14px"* while simultaneously reporting 100% abandonment.
The spatial findings were valid-but-trivial; the abandonment was an artifact of a
surface with no affordances. Forcing a non-visual tool through the same pipeline
would produce that noise with none of the signal.

## Key insight

The valuable part of EVE is already modality-agnostic.

`src/browser/adapter.ts` states the contract's philosophy: adapters "are
deliberately dumb: they perceive and they actuate. Every decision — where to
click, what to type, when to wait — belongs to the cognition engine."

Everything downstream — personas, emotion, patience, memory, scoring, the
researcher panel, reporting — consumes a `Percept`. **Anything expressible as a
`Percept` inherits the entire apparatus for free.** `src/browser/mock.ts` already
proves the contract is satisfiable with no browser at all, and describes itself as
"a reference for adapter authors."

Inspecting `src/core/types.ts` shows the boundary is narrower than expected:

| `Percept` / `VisibleElement` field | Modality |
| --- | --- |
| `timestamp`, `url`, `title`, `dialogs`, `loadingIndicator` | neutral |
| `elements[].role`, `.text`, `.interactive`, `.disabled`, `.editable`, `.focused` | neutral |
| `viewport`, `scrollY`, `scrollHeight`, `screenshot` | spatial |
| `elements[].box`, `.clippedByViewport` | spatial |
| `elements[].color`, `.backgroundColor`, `.fontSize` | visual, **already optional** |

The visual properties are already `?`-optional, so the type system tolerates their
absence today. Only `box` is mandatory.

### Text has real geometry

A terminal is not a fake screen. Text genuinely occupies rows and columns, so
character-cell geometry is an *honest* `box`, not a fabricated one. What is absent
for a textual surface is **pixel-visual** styling: font size, color, contrast,
clipping. That is the precise line this design draws.

### Reinterpreting the perception boundary

`src/core/types.ts` currently says a `Percept` contains "never DOM internals,
network traffic, console output or source code." A CLI adapter deliberately
reinterprets the *console output* clause. This does not weaken the human-perception
principle — it recognizes that for a terminal user, console output **is** the
screen. Network traffic, source code and internal state remain out of bounds: the
adapter may only perceive what the tool actually prints to a user.

## Approaches considered

| Approach | Core changes | Assessment |
| --- | --- | --- |
| **A. Pure projection** — satisfy `BrowserAdapter` as-is with synthetic screens | none | Rejected. Invents `scrollY`, pixel boxes and font sizes for things that have none, manufacturing exactly the noise observed in the dashboard study. |
| **B. Full re-architecture** — new `Surface` core above `BrowserAdapter`; cognition reasons over abstract affordances | large | Rejected *for now*. Honest, but touches `core/types.ts` and all of `cognition/`, risking the working browser path for a capability with no proven consumer yet. |
| **C. Capability-flagged projection** | ~1 flag + guards | **Chosen.** Adapters declare their modality; spatial-only checks skip when unsupported. Achieves B's honesty at A's risk level, and is a legitimate stepping stone to B. |

## Design

### 1. Surface capabilities

New `src/surface/capabilities.ts`:

```ts
export interface SurfaceCapabilities {
  /** Pixel geometry and visual styling are meaningful. */
  readonly spatial: boolean;
  readonly modality: "visual" | "textual";
  readonly canScreenshot: boolean;
  readonly canGoBack: boolean;
  readonly canScroll: boolean;
}
```

`BrowserAdapter` gains `readonly capabilities: SurfaceCapabilities`. Existing
adapters (playwright, puppeteer, selenium, mock) declare
`{ spatial: true, modality: "visual", ... }` — a purely additive change with no
behavioral difference.

The interface keeps its current name for compatibility; `SurfaceAdapter` is
introduced as an alias to signal intent without a breaking rename.

### 2. Text-frame layout

New `src/surface/textFrame.ts` converts a rendered text frame into
`VisibleElement[]` with character-cell boxes:

- input: lines of text plus a set of detected affordances
- `box.x` = column × cell width, `box.y` = line × line height
- `fontSize`, `color`, `backgroundColor` are omitted (already optional)
- `clippedByViewport` reflects the terminal window height

This is the shared substrate for every textual surface, including the MCP provider
in Spec 2.

### 3. CLI / process adapter

New `src/surface/cli.ts` implementing the adapter contract against a real process:

| Contract method | CLI meaning |
| --- | --- |
| `open(url)` | `cli:<command>` — spawn the entry command, capture stdout/stderr |
| `snapshot()` | current terminal frame → percept |
| `clickAt(point)` | run the affordance at that cell (a suggested next command) |
| `typeText()` | write to the process's stdin |
| `pressKey("Enter")` | submit the current input line |
| `scrollBy()` | move the visible window over scrollback |
| `goBack()` | unsupported → `canGoBack: false` |
| `screenshot()` | `null` → `canScreenshot: false` |

**Affordance detection is the core perception problem.** A terminal's affordances
are the things a user can act on next:

1. commands the output explicitly suggests (`run \`npm install\` to fix`)
2. an interactive prompt awaiting input
3. documented subcommands surfaced by `--help`

This is what makes the adapter a genuine DX instrument. A CLI that tells you what
to do next presents affordances; one that dumps a bare stack trace presents a
dead end. EVE's existing abandonment and confusion machinery then measures that
difference without modification — *"the operator gave up"* becomes a true finding
about the tool rather than an artifact of the harness.

### 4. Guarding spatial checks

Checks that assume pixels are gated behind `capabilities.spatial`:

- `src/plugins/accessibility.ts` — font-size, contrast, and box-geometry checks
  (`el.box.width > 32`-style thresholds)
- the vision/multimodal layer — screenshot-dependent analysis

Guarded checks are **skipped, not failed**, and the report states that the
dimension was not assessed, so a textual surface never scores as if it failed a
visual audit.

## Data flow

```
process/tool  →  CliAdapter  →  text frame  →  textFrame layout  →  Percept
                                                                       ↓
                              (unchanged) cognition → emotion → findings → report
```

Nothing right of `Percept` changes.

## Error handling

- **Process exits unexpectedly** → terminal frame showing the exit status and any
  final output; the surface becomes affordance-free, which cognition perceives as
  a dead end (correct behavior, not an error).
- **Process hangs** → no frame change within the settle window, surfaced as
  perceived latency, feeding the existing patience model.
- **Spawn fails** (binary missing) → adapter `open()` rejects; the session reports
  a setup failure rather than a UX finding, since the operator never reached a
  surface.
- **Non-UTF8 / control-character output** → sanitized during frame rendering; ANSI
  escapes are parsed for cursor positioning and stripped from perceived text.

## Testing

- **Unit** — `textFrame` layout: line/column → box math, wrapping, window clipping.
- **Unit** — affordance detection against fixture outputs (suggested commands,
  prompts, `--help` listings, bare stack traces).
- **Integration** — `CliAdapter` against deterministic fixture scripts, mirroring
  how `mock.ts` enables browser-free engine tests.
- **Guard regression** — a textual-surface session asserts that no font-size,
  contrast, or screenshot-derived finding is ever emitted.
- **Non-regression** — the existing browser path is unchanged; adapters only gain
  a `capabilities` field.
- **Live validation** — a real session against Axiom's operator scripts
  (`restart_proxy.ps1`, `update_axiom.ps1`, `curl /metrics`), which is the
  motivating use case.

Coverage target 80%, per project standards.

## Out of scope

Deliberately excluded from this spec:

- the MCP surface provider (Spec 2)
- the agent-operator cognition model and human-vs-agent comparison (Spec 3)
- any change to cognition, scoring, or reporting
- the full `Surface` re-architecture (Approach B)

## Roadmap

1. **This spec** — surface capability + CLI provider. Establishes and proves the
   seam. CLI first because terminal output genuinely is rows of text, making it the
   least violent fit and the fastest honest validation.
2. **MCP surface provider** — `tools/list` as an affordance menu, a tool call as a
   transition, an error as a dialog. Answers whether a fresh agent can navigate a
   large tool surface. Depends on this spec's seam and `textFrame`.
3. **Agent-operator model + comparison harness** — patience as tool-call budget,
   confusion as wrong-tool selection, reading speed as context cost; then diff
   human-operator against agent-operator populations on the same surface. This is a
   `cognition/` change, not an adapter change, which is why it is separated.

## Open questions

- Should affordance detection be heuristic-only, or optionally LLM-assisted like
  the existing `LlmCriticPlugin`? Heuristic-only is assumed for this spec.
- Should a textual surface report an `overall` score at all, given several
  dimensions are unassessable? Assumed yes, computed over assessed dimensions only,
  with the exclusions stated in the report.
