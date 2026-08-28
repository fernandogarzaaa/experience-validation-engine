# Rendering Truth — what reached the screen, against what the page claims

**Status:** landed. Applies to visual surfaces only.

EVE's perception script (`src/browser/perceptionScript.ts`) walks the rendered
document and reports what it finds. That is fast, exact, and it is also what
assistive technology consumes — so it is the right default, and it stays the
default.

But it is a *claim*. Everything EVE knows about a page that way is what the
page says about itself. This module reads the other source: the pixels that
actually reached the screen. Neither replaces the other, and the findings live
in the gap between them.

## What this catches that a DOM-based tool cannot

| Finding | What happened | Who else can see it |
| --- | --- | --- |
| `unaccounted-content` | Content is painted into a canvas, or baked into an image, with nothing in the markup for it | **Nobody.** Not a screen reader, not EVE, not any DOM-based tool |
| `unrendered-text` | The DOM carries text that never reached the screen — a stylesheet, a font, or an overlay ate it | The DOM says it is fine |
| `phantom-control` | The DOM offers an interactive element that isn't drawn | Automation clicks it happily; a person cannot find it |

The first row is the reason the module exists. A DOM-only tool cannot find it
in principle, because there is nothing in the DOM to find. The pixels are the
only evidence that the content is there at all.

## It does not read the text, on purpose

No OCR. To report that a person can see something the page does not account
for, it is enough to establish that *something legible is rendered there* —
recognising the words would answer a question nobody asked, and would cost
determinism, a dependency, and a great deal of time per percept.

So it classifies regions the way you can at a glance, before reading:
`text`, `graphic`, `solid`, `blank`.

## How it works

### 1. Ink — is anything drawn here?

Everything rests on the **variance** of luminance inside a small cell, not its
brightness. Brightness says what colour something is; variance says whether
anything is drawn there.

- blank area, any colour → near-zero variance
- middle of a filled button → near-zero variance
- glyph strokes against their background → a lot of it

The grid is coarse deliberately: a cell is 4 CSS pixels, which turns a
million-pixel screenshot into ~60k cells and still puts text at ordinary sizes
into three or four cell rows.

The page background is the **mode** of the blank cells, not the mean. A mean
gets dragged toward whatever dominates the screen, so one dark hero image
would make a white page read as grey.

### 2. Regions — what is drawn, and what does it look like?

Two passes, because the unit a flood fill finds is not the unit a person
perceives.

A fill over inked cells bridges a small **horizontal** gap, so a row of words
becomes one line instead of five disconnected blobs. It deliberately does not
bridge vertically — the space between lines is genuinely blank.

That leaves one blob per *line*, which is the wrong unit twice over: line
rhythm is a property of a block of type and is invisible from a single line,
and a reader looking at a chart sees one chart rather than four captions. So a
second pass assembles lines into blocks, joining those that sit close **and**
share a margin. (Proximity alone would let a caption absorb the unrelated
control beside it.)

Only then is the rhythm question meaningful. Set type alternates bands of
glyphs with clean gaps at a regular pitch, and the band heights are
consistent. A photograph carries ink in nearly every row and produces almost
no gaps. A single thin band much wider than it is tall is one line of type — a
heading, a label, a button caption — and must not be mistaken for a picture
just because it has no neighbour.

### 3. Reconciliation — does the rendering match the claim?

Every check is deliberately conservative. **Telling someone their working page
is broken is a worse failure than staying quiet about a real problem**, because
it is the one that makes them stop believing the tool. Where a signal is
ambiguous, nothing is reported.

Specifically:

- Elements only partly inside the viewport are skipped entirely. The
  screenshot stops at the viewport edge, so their missing pixels are missing
  because they were never captured. Reporting them would fire on every page
  with content below the fold.
- A box with no ink is only a `phantom-control` if it is *also*
  indistinguishable from the page background. A filled button with no label
  carries almost no ink and is plainly visible.
- Coverage for `unaccounted-content` is summed over DOM boxes that may overlap
  each other, so it over-estimates true coverage. That bias is the safe
  direction: it can only make the check quieter.

## Thresholds are perceptual, so they are in CSS pixels

Every constant is counted in cells — how far a fill reaches to bridge a word
gap, how close two lines must be to form a block, how thin a band reads as one
line of type. Those are facts about human perception.

Defining the cell in *device* pixels halves all of them on a 2x display. The
symptom was concrete: one canvas that produces a single finding at 1x
shattered into eight at 2x. `cellFor(scale)` keeps the cell a fixed perceptual
size, and `tests/rendering.test.ts` asserts 1x and 2x reach the same conclusions.

## Determinism

Contractual, like everywhere else in EVE. This is pure integer and float
arithmetic over the decoded image — no randomness, no clock, no I/O. Regions
are sorted by area with position as a tiebreak, giving a **total** order, so
two equal-area regions cannot swap between runs.

## Fixtures are real renders, not synthetic images

`tests/fixtures/rendering/` holds real Chromium output captured through EVE's own
perception script, with the source pages beside them.

This mattered. Hand-drawn PNGs confirm whatever the author already believed
about how text renders. Chromium found four bugs that a synthetic image would
have agreed with:

1. the flood fill produced one blob per line, so the multi-line rhythm test
   could never fire and **all prose classified as imagery**;
2. a canvas produced one finding per line of text rather than one for the
   chart a reader sees;
3. cell quantisation pulled the button above into the box below it, hiding a
   paragraph that was genuinely invisible on screen;
4. thresholds in device pixels halved on a 2x display.

To regenerate the fixtures, render `disagreements.html` and `clean.html` at
900x700 and capture both the screenshot and `PERCEPTION_SCRIPT`'s output.

## Where it runs

Inside `runVisionChecks` in the session loop, behind the same
`capabilities.spatial` guard and the same per-screen signature guard — a
screen revisited five times is examined once. Findings are filed under the
registered category `rendering.fidelity`, which carries `evidenceRequired: true`
and `appliesTo: ["visual"]` like every other pack vocabulary.

`unaccounted-content` is `major`; the other two are `minor`. Content a person
can see and nothing else can reach is the severe case — unlike a control
nobody can see, no amount of reading the markup reveals it.

## What it is not

This is **stage one**: it perceives and reports. It does not yet feed
pixel-discovered affordances into the percept for cognition to act on, so EVE
still decides what to click from the DOM. That is the natural next step, and
it is deliberately separate: letting cognition act on fuzzy pixel regions is a
much larger behavioural change than reporting what the pixels show.

## API

```ts
import { inspect, observe, reconcile } from "experience-validation-engine";

// Everything in one pass (the grid is built once):
const { observation, issues } = inspect(percept);

// Or separately:
const seen = observe(percept.screenshot, percept.viewport);
const issues = seen ? reconcile(percept, seen) : [];
```

`observe` returns `null` rather than throwing on a missing or corrupt
screenshot, or a zero-sized viewport.
