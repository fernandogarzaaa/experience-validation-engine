# Human Digital Twins (Phase 3)

A **digital twin** is a persistent, named user model that *evolves* across
sessions — "Power User A", "Senior Accountant", "College Student". Unlike a
persona (a fixed archetype), a twin accumulates experience: it remembers the
apps it has used, grows more expert, and its confidence baseline drifts toward
its lived performance.

```ts
import { createTwin, runTwinSession, FileTwinStore } from "experience-validation-engine";
import { PlaywrightAdapter } from "experience-validation-engine";

const store = new FileTwinStore(".eve-twins.json");
let twin = (await store.load("power-user-a")) ?? createTwin({
  id: "power-user-a", name: "Power User A", basePersona: "power-user",
});

const { twin: evolved } = await runTwinSession(twin, {
  adapter: new PlaywrightAdapter({ headless: true }),
  url: "https://staging.example.com",
  goal: "create a project",
});
await store.save(evolved); // persist the evolution
```

## What evolves (`TwinProfile.evolution`)

| Field | Behaviour |
|---|---|
| `sessions` | Increments each run |
| `expertise` | Grows with diminishing returns (power law of practice) |
| `confidenceBaseline` | Drifts toward lived performance (feeds the persona's starting confidence next time) |
| `scoreHistory` / `trustHistory` | Per-session series |
| `meanScore` | Running mean |
| `appsExperienced` | Distinct apps the twin has used |
| `memories` | Learned per-app knowledge (reused across sessions, so the twin gets faster on familiar apps) |

`runTwinSession` seeds an in-memory store from the twin's `memories`, runs an
ordinary `EveSession` as the twin's evolved persona, then folds the updated
memory and a fresh evolution back into the profile. `renderTwinMarkdown` prints
the profile.

## Persistence

- `InMemoryTwinStore` — for tests.
- `FileTwinStore(path)` — a JSON file holding many twins, keyed by id.

## Via MCP

`eve_twin_session` runs one session as a twin and persists it to `twin_file`.
Call it repeatedly with the same `twin_file` / `twin_id` to evolve the twin
across separate agent turns — it's created on first use (`name` +
`base_persona`) and loaded thereafter. See [integrations.md](integrations.md).

## Relationship to long-term memory

Twins build on Phase-2 [persistent memory](developer-guide.md): the memory gives
per-app learning, and the twin wraps it in a durable, named identity with an
evolving disposition — a user you can bring back, session after session.
