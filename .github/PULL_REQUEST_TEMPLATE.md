# What this changes

<!-- One logical change per PR. What is different after this merges, and why? -->

## Ground rules

<!-- See CONTRIBUTING.md. Tick what applies; explain anything you cannot tick. -->

- [ ] **Prime directive** — cognition still acts only on human-perceivable
      information. No DOM internals, network data, console output or source
      structure reached the decision path.
- [ ] **Determinism** — the same `(appState, persona, seed)` still produces the
      same run. New randomness flows through the session `Rng`.
- [ ] **Evidence** — new findings carry the observation that triggered them;
      new scores carry evidence strings.

## Checks

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run coverage` (thresholds hold)
- [ ] `npm run test:browser` — only if this touches a browser adapter or the
      perception script

## Behaviour change

<!--
If this changes decision-making, paste a before/after session journal for the
mock app. Reviewers judge realism from the journal, not from the diff or the
scores. Delete this section if the change is not behavioural.
-->

## Docs

- [ ] Public API changes have matching updates in `docs/`
- [ ] Not applicable
