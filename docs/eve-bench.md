# EVE Bench (Phase 3)

**EVE Bench** is the formal benchmark platform for the experience-validation
instrument itself. Where `eve benchmark` checks one construct-validity property
(excellent > average > bad on the overall score), EVE Bench runs a suite of
known-quality reference apps through the **full cognitive simulation** and
publishes a multi-dimensional scorecard.

```ts
import { runEveBench, renderEveBenchMarkdown } from "experience-validation-engine";

const report = await runEveBench({ seed: 7 });
console.log(report.overall);   // 0..100
console.log(report.ordered);   // construct validity holds?
console.log(renderEveBenchMarkdown(report));
```

## The scorecard

Each benchmark case is scored on:

| Dimension | Direction | Source |
|---|---|---|
| Task success | higher | goal achieved across a persona panel |
| Overall experience | higher | the 0–100 score |
| Frustration | lower | end-state emotion |
| Trust | higher | end-state emotion |
| Cognitive load | lower | NASA-TLX-style Cognitive Load Index |
| Expectation alignment | higher | mean expectation `matchScore` |
| Learnability | higher | step reduction on a second, memory-backed run |

These roll up into a per-case **composite** (0–100) and an **overall** bench
score. `ordered` is the standing construct-validity check: the composites must
rank excellent > average > bad, or the instrument is miscalibrated.

## Extending the suite

`EVEBENCH_CASES` is the default suite (the three reference apps). Pass your own
`cases` (each a `MockAppSpec` + goal + success signal + tier) to
`runEveBench({ cases })` to benchmark against your own reference set.

## Publishing scores & CI

`examples/eve-bench.ts` prints the scorecard and exits non-zero if construct
validity fails — drop it into CI to catch a regression in EVE itself. The MCP
tool `eve_bench` returns the same scorecard for an AI agent to publish or gate
on. See [integrations.md](integrations.md).
