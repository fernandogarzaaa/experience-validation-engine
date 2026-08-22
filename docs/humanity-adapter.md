# The Humanity Adapter — EVE reads

> **What it adds:** EVE could always *operate* software. It could not read
> what software produces. The humanity adapter puts a simulated reader in
> front of any digital output — a report, a deck, an analytics export, a
> `--help` screen, a stack trace, an API payload — and reports the
> experience of trying to understand it.

Every adapter EVE shipped before this one puts the operator in front of
something they **drive**: a web page, a phone screen, a terminal, an MCP tool
catalog. But most of what software actually shows people is not driven at
all. It is **received**: the quarterly report, the migration guide, the CI
log pasted into a Slack thread, the dashboard export that decides a budget,
the JSON someone is squinting at during an incident.

Those artifacts fail for human reasons, and none of them are usability
failures in the button-size sense. Nobody bounces off a document because a
control was 3px too small. They bounce off it because the third paragraph
used a term the first eleven pages never defined, because the number that
mattered had nothing to compare against, because the slide had forty words
on it, or because they finished and still did not know what they were
supposed to do.

`eve read` is that experience, measured.

```
$ eve read ./docs/q3-review.md --persona first-time-user --seed 3

  #0 doc.skim — 65 words — I'll skim this section for anything that matters.
  #1 doc.read — Reading "Q3 Platform Review".
  #2 doc.reread — I didn't follow that — Our SLO attainment improved materially
     this quarter following the migration to the new orchestration layer,
     though the …. Let me read it again.
  #3 doc.next — Done with this section — moving on.
  #4 doc.read — Reading "Numbers".
  ...
  ────────────────────────────────────────────────
  Artifact                 : document, 3 section(s), 107 words (markdown)
  Understood               : 39/100
  Reading ease             : Flesch 40.24 (grade 10.88)
  Reading time             : 0.4 min at this reader's pace
  Findings                 : 0 critical, 1 major, 2 other
  Outcome                  : goal-achieved
```

The reading report names where it went wrong, and quotes it:

```
## Where the reader lost the thread

- `█░░░░░░░░░░░` 9% — section "Q3 Platform Review"
  > Our SLO attainment improved materially this quarter following the migration…
  - long-sentence: Our SLO attainment improved materially this quarter following…
  - undefined-term: "SLO" is used without ever being expanded
  - undefined-term: "SRE" is used without ever being expanded
  - jargon: orchestration, throughput, sharded, latency
- `██████░░░░░░` 50% — section "Numbers"
  > (image with no alternative text)
  - unlabeled-figure: figure ./charts/latency.png carries no caption or alternative text
```

---

## 1. The `"document"` modality

Reading is not "textual with extra fields". A terminal has character-cell
geometry and a live process at the other end; a document has **reading
order**, sections you turn between, and figures. The two fail differently,
so the kernel names them differently:

```ts
type KernelPercept =
  | { modality: "visual";   viewport; scrollY; scrollHeight; screenshot; …base }
  | { modality: "textual";  lines; windowRows; scrollLine; …base }
  | { modality: "document"; blocks; section; sectionCount; sectionNoun;
                            totalBlocks; blocksRead; …base }          // ← new
```

Three things came with it, all additive:

| Kernel concept | What documents needed |
| --- | --- |
| `AffordanceLocator` | `{ kind: "readingOrder", section, block }` — a reader is "in the third paragraph of section 2", not at a pixel or a cell |
| `SurfaceSignal` | `end-of-content` (a document *ends*; a page and a tool catalog do not) and `comprehension-gap` (something read but not understood — perceived, unlike an error, which is announced) |
| `Modality` | `"document"` joins `"visual"` and `"textual"` in `ALL_MODALITIES`, so every existing registry entry that applied to "all modalities" still does |

`DOCUMENT_SURFACE` declares `spatial: false`, so the Phase-0 honesty gate
skips every pixel-derived check — a report is never scored for tap-target
size, exactly as a terminal never is.

**One behavioral change outside the seam.** Error *perception* is now
modality-gated (`perceivesError`, `errorSnippets`, `comparePrediction`). On
a driven surface, "Invalid password" is an error the operator faces. On a
document it is a topic: a report line reading `Error rate: 0.4%` is not a
failure, and a stack trace quoted in a bug report is something the reader is
reading *about*. There is nothing to retry or dismiss on a page of text, so
a document never raises the error-recovery subgoal. What the artifact says
about errors is judged by the comprehension model instead, where an
unexplained failure with no next step is a finding about the *writing*.

## 2. The artifact model

Every reader produces the same shape (`src/humanity/types.ts`): blocks in
reading order, grouped into sections.

```ts
interface Artifact {
  address; title; format; genre;
  sections: { index; title; noun; blocks: number[] }[];
  blocks:   { id; kind; text; depth; section; table?; metric?; figure?; reference? }[];
  meta:     Record<string, string>;
}
```

`genre` is the most load-bearing field in the model, because genre is what
sets a reader's expectations:

| Genre | What the reader expects | What gets flagged |
| --- | --- | --- |
| `document` | structure, a lede, a next step | walls of text, no headings, buried conclusion, no call to action |
| `presentation` | one idea per slide | dense slides, >6 bullets, titles that name a topic instead of making a point |
| `analytics` | numbers you can act on | metrics with no baseline, numbers with no unit, table columns with unitless headers |
| `transcript` | what happened, and what to do | errors that state a cause but no remedy |
| `data` | a shape you can hold | nesting past working memory |
| `interface` | every option explained | flags and commands listed with no description |

## 3. Formats

Detection is a confidence auction, not a switch on file extension — most
artifacts arrive with no filename at all (piped in, pasted, fetched).

| Reader | Recognizes | Notes |
| --- | --- | --- |
| markdown | `.md`, or ≥2 markdown constructs | `---`-separated decks become `presentation` |
| html | `.html`, doctype, or ≥4 block tags | tokenizer, not a DOM: script/style/template never reach the reader |
| json | `.json`, or parses as JSON | uniform arrays of records read as tables |
| yaml | `.yaml` / `.yml` | |
| csv/tsv | `.csv` / `.tsv`, or uniform delimiter counts | quoting handled |
| transcript | `.log`, prompts, log levels, stack frames | commands open sections |
| text | everything else (the floor) | infers headings, bullets, code and CLI help layout |

No new dependencies: the only parser pulled in is `yaml`, already a runtime
dependency.

## 4. The comprehension model

Two things happen (`src/humanity/comprehension.ts`).

**Per block**, a reader with this persona's reading speed, tech literacy and
thoroughness either follows it or does not. Comprehension is a probability,
and obstacles compound *multiplicatively* — each is an independent chance of
losing the thread, which is why three small problems in one paragraph lose a
reader that one large problem would not:

```
comprehension = (1 - registerCost) × ∏(1 - obstacleCost)
```

Obstacles: `long-sentence`, `undefined-term`, `jargon`, `wall-of-text`,
`unlabeled-figure`, `missing-baseline`, `wide-table`, `deep-nesting`,
`dense-slide`, `raw-error`.

It is genuinely persona-relative. The same passage:

```ts
// "The idempotent retry path relies on backpressure from the sharded write
//  layer, so SLO attainment degrades when replication lag exceeds the quorum
//  window."
analyzeComprehension(dense, getPersona("first-time-user")).comprehensionScore  // 35
analyzeComprehension(dense, getPersona("power-user")).comprehensionScore       // 85
```

**Across the artifact**, expectations are checked against the genre and
become findings. An acronym counts as introduced only where the artifact
expands it — `Service Level Objective (SLO)`, `SLO (Service Level
Objective)`, or `SLO stands for …` — which is exactly the rule a good editor
applies. Acronyms every reader already has (`API`, `JSON`, `HTTPS`, …) are
never counted.

Every finding cites the text that caused it. A comprehension claim with no
quotation is the vibes-based judgment EVE's evidence rule exists to prevent,
so `humanity.*` categories carry `evidenceRequired: true` like every other.

The analysis is pure and deterministic: same artifact, same persona, same
result — so it can be asserted in tests and diffed across builds.

## 5. Reading is its own cascade

`HeuristicCognition` gains a document branch that fires only on a document
kernel, so every existing surface behaves byte-for-byte as before. A person
driving software asks "what can I click"; a reader asks "do I understand
this, and is it worth going on":

1. I reached the end — **I am done, not stuck**.
2. I'm too frustrated to keep reading → put it down.
3. I did not follow that → re-read it, if I have the patience (`thoroughness × 0.6 + patience × 0.4`).
4. Something here answers what I came for → study it.
5. I haven't read this section → read it, or **skim** it if I'm a skimmer.
6. A reference leads where I'm going → follow it.
7. Turn the page.

Skimming matters: a skimmer genuinely does not perceive what they skipped,
so the same artifact produces different findings for a thorough reader and
an impatient one — which is the point of running personas at all.

Finishing is modeled as **success**. The reader perceives a real end-of-
artifact line, and that is the session's goal success signal, so a document
EVE read through ends `goal-achieved` and one it put down halfway ends
`abandoned`. A reader who reaches the end without what they came for goes
back through it once, then stops — which is what people do.

## 6. Scoring

Three registered, document-only dimensions, each fed by its own finding
category through the scorer's generic registered-dimension rule:

| Dimension | Measures |
| --- | --- |
| `humanity.comprehension` | terms defined before use, figures that assert something, numbers with a baseline, an ending that says what to do |
| `humanity.readability` | the cost of parsing the prose itself |
| `humanity.structure` | whether it can be scanned, re-entered and navigated |

They are `appliesTo: ["document"]`, so a live page is never scored for
baselines and a document is never scored for `visualDesign`. A reading
session with no comprehension findings simply does not report the dimension
rather than inventing a perfect score for it.

## 7. Usage

```bash
eve read ./docs/quarterly-report.md --persona elderly-user
eve read ./deck.md --genre presentation --persona impatient-user
eve read ./metrics.csv --goal "did signups grow"
eve read https://example.com/changelog.html --report .eve-output/reading.md
git log --oneline | eve read - --genre transcript
eve read ./api-response.json --json          # analysis as JSON

eve run doc:./README.md                      # doc: routes anywhere a URL goes
```

Programmatically:

```ts
import { readArtifact, readText, analyzeComprehension, artifactFromText } from "experience-validation-engine";

// Full reading session: an ordinary SessionResult, plus the analysis.
const result = await readArtifact("./docs/onboarding.md", { persona: "first-time-user" });
result.comprehension.comprehensionScore;   // 0..100
result.endReason;                          // "goal-achieved" | "abandoned" | …

// No session, no filesystem — just the judgment.
const artifact = artifactFromText("spec.md", markdown);
const analysis = analyzeComprehension(artifact, getPersona("power-user"));
```

`eve read` exits non-zero on a critical finding, so it works as a CI gate on
the documentation and reports a product ships — the same way `eve run` gates
the product itself.

The `eve_read_artifact` MCP tool takes the same targets with one exception:
standard input. The server speaks JSON-RPC over stdio, so `process.stdin` is
the transport itself and a tool that consumed it would hang the call. Pass a
path or a URL there.

## 8. Where the perception boundary sits

Unchanged, and if anything tighter. A reader perceives the artifact's
rendered content: front matter that renders is content, an HTML `<title>` is
content, a build ID in a comment is not. There is no source, no file
metadata, no `<script>` body — a person handed a PDF cannot see who
generated it either.

## 9. Files

| Path | What lives there |
| --- | --- |
| `src/humanity/types.ts` | the artifact model |
| `src/humanity/readers/` | one reader per format, plus the detection auction |
| `src/humanity/readability.ts` | Flesch/Flesch–Kincaid, syllables, acronyms, jargon |
| `src/humanity/comprehension.ts` | per-block comprehension and genre expectations |
| `src/humanity/adapter.ts` | `HumanityAdapter` — kernel-native document surface |
| `src/humanity/read.ts` | `readArtifact` / `readText` — the reading session |
| `src/humanity/plugin.ts` | `ComprehensionPlugin` |
| `src/humanity/vocabulary.ts` | the `humanity.*` registrations |
| `src/humanity/report.ts` | the reading report |
