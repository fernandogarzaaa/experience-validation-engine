# Contributing to EVE

Thanks for helping build AI that experiences software like a human.

## Ground rules

1. **The prime directive is non-negotiable.** The simulated operator may
   only act on human-perceivable information. PRs that leak DOM internals,
   network data, console output or source structure into cognition will be
   declined — put such capabilities behind clearly-separated opt-in plugins
   if they are genuinely valuable.
2. **Determinism is a feature.** All randomness must flow through the
   session `Rng`. If your change makes two runs with the same seed diverge,
   it's a bug.
3. **Findings need evidence, scores need provenance.** Every finding carries
   the observation that triggered it; every score dimension carries evidence
   strings.

## Development

```bash
npm install
npm run lint         # Biome: lint, format, import order
npm run typecheck    # strict TypeScript, zero errors expected
npm test             # vitest, fully offline (mock adapter)
npm run coverage     # same suite + coverage thresholds
npx tsx examples/basic-run.ts
```

- Node ≥ 18.17. Style and correctness are gated by two tools: `tsc` with
  strict options (`noUncheckedIndexedAccess`, etc.) and Biome
  (`biome.jsonc`). `npm run lint:fix` applies the safe fixes.
- Tests must not require a browser or network. Engine behavior is tested
  against `MockAdapter`, which keeps the suite fast and deterministic.
- The one exception lives outside `npm test`: `npm run test:browser` drives
  real Chromium against a loopback fixture site to verify the adapter
  contract. Adapters are typed against hand-written duck types for the
  driver's `Page`, so nothing else — not `tsc`, not `MockAdapter` — can
  catch upstream API drift. Run it if you touch `src/browser/` or the
  perception script:

  ```bash
  npx playwright install chromium
  npm run test:browser
  ```

- Coverage thresholds are a ratchet against regression, not a target. If a
  change lowers them, that needs saying out loud in the PR.

## Good first contributions

- New personas (with a short justification of the trait choices).
- New workflow signatures (`src/workflow/catalog.ts`).
- New geometry/pixel checks (`src/vision/analysis.ts`) with unit tests.
- New plugins (see `docs/plugin-guide.md`).
- Roadmap items tagged 🤝 in `ROADMAP.md`.

## Pull requests

- One logical change per PR.
- Add or extend tests for behavior changes; keep `npm test` green.
- If you change decision-making, include a before/after session journal for
  the mock app in the PR description — reviewers judge realism from the
  journal, not just the diff.
- Public API changes need matching updates in `docs/`.

## Reporting issues

Include: EVE version, adapter, persona, seed, and the session journal
(`report.md` § Session Journal) if the issue is behavioral. A minimal
`MockAppSpec` reproducing a cognition bug is gold.

## Code of conduct

Be kind, assume good faith, critique ideas rather than people.
