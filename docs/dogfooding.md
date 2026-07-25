# Dogfooding: EVE on EVE

EVE validates the human experience of software. The sharpest test of that claim
is turning it on itself.

```bash
npx tsx examples/eve-on-eve.ts
```

## What this actually is (and isn't)

EVE has no web UI — it's a CLI, a library, and an MCP server — so it cannot
literally look at its own screen. [`examples/eve-on-eve.ts`](../examples/eve-on-eve.ts)
therefore models EVE's *workflow* as a mock app (landing → personas → docs →
configure → running → report → settings) and runs the full Phase-3 pipeline
over it: population study → moderated panel → product intelligence → predictive
UX → application map → multimodal scan.

**Read the output honestly.** The friction in that mock — icon-only controls,
export buttons with no visible response, a dense configuration screen — is
*deliberately authored*, so the run has something real to find. The resulting
"DO NOT SHIP" verdict describes **the model**, not EVE's actual codebase.

What the exercise genuinely validates is EVE's **analysis layer running on a
tool/console** — an app shape well outside the e-commerce funnel its
classifiers were originally tuned for. That's where the real bugs were.

## What it caught

Pointing EVE at a non-commerce app surfaced three real gaps, all since fixed:

| Gap | Symptom | Fix |
|---|---|---|
| **Web-commerce-biased classifiers** | `report`, `running`, `newStudy` all classified as "Other"; `docs` mislabeled as "Content / editor" | Broadened `GOAL_RULES` / `PURPOSE_RULES` to cover reporting, tasks/runs, help/docs, and configuration, with token normalization so `newStudy` and `search-results` match on word boundaries |
| **Goal-less step reporting** | Interaction Designer flagged "the happy path is too long (60 steps)" — but with no goal, "completed" just means "didn't abandon", so steps collapse to the *budget* | Gated the observation on a goal being set; open-ended runs report exploration depth neutrally |
| **Reports mislabeled the target** | Headers read "— mock:" even when an `adapterFactory` served a differently-named app | Added an optional `label` (defaults to `url`) threaded through the study, product, and prediction headers — `url` keeps its identity meaning |

Fixing those triggered a code review that caught four more issues *in the
fixes* — including a public field whose meaning I'd silently changed, and the
same classifier overlap fixed in one rule set but missed in its twin. The
regression tests for all of it live in
[`tests/dogfooding.test.ts`](../tests/dogfooding.test.ts).

## The lesson

The bugs weren't in the simulation — they were in the **interpretation layer**,
and they only appeared when the tool was pointed somewhere outside its comfort
zone. That is the whole argument for dogfooding: not that the self-test produces
a flattering score, but that it produces an *uncomfortable* one in a place you
weren't looking.

If you extend EVE's analysis (new classifiers, new specialists, new reports),
run this example against the console model first. If your addition says nothing
useful about a tool-shaped app, it's probably tuned too narrowly.

## Going further

The loop can be made literal by driving EVE through **its own MCP server** —
`eve_bench` is EVE benchmarking EVE, and `eve_run_user_study` will convene the
research panel over any target. See [integrations.md](integrations.md).
