# Autonomous Exploration → Application Map (Phase 3)

Given only a URL — no predefined workflows, no sitemap, no app source — EVE
explores an app like a curious human and reconstructs a complete **application
map** from what it *perceived*.

```ts
import { EveSession, PlaywrightAdapter, buildApplicationMap, renderApplicationMapMarkdown } from "experience-validation-engine";

const results = [];
for (const persona of ["curious-explorer", "power-user", "first-time-user"]) {
  results.push(await new EveSession({
    adapter: new PlaywrightAdapter({ headless: true }),
    startUrl: "https://staging.example.com",
    persona, maxSteps: 60,
  }).run());
}

const map = buildApplicationMap(results);
console.log(renderApplicationMapMarkdown(map)); // includes a Mermaid nav graph
```

More explorers → broader coverage. Each session's `capturedScreens` supply the
screens and their affordances; its action journal supplies the transitions.

## What it maps (`ApplicationMap`)

| Field | Meaning |
|---|---|
| `screens` | Each discovered screen: inferred **purpose**, visible **affordances**, in/out degree, and **unexercised** affordances (candidate hidden / edge functionality) |
| `transitions` | The navigation graph — from → to, via which action, with counts |
| `entryPoints` | Where exploration began |
| `hubs` | The highest-connectivity screens |
| `deadEnds` | Screens with no observed way forward |
| `coverage` | Screens and transitions discovered |

`renderApplicationMapMermaid(map)` returns just the navigation graph as a
Mermaid `flowchart`; `renderApplicationMapMarkdown(map)` embeds it in a full
report that also groups screens into an **information architecture** by purpose.

Everything is inferred from perception only — the human-perception boundary
holds (EVE never inspects routes, DOM internals, or source).

## Via MCP

`eve_application_map` runs the explorers and returns the map (with the Mermaid
graph) in one call — so an AI coding agent can ask "what does this app contain
and how is it structured?" See [integrations.md](integrations.md).

## Relationship to workflow discovery

This builds on EVE's per-session workflow discovery (`detectWorkflow`,
`WorkflowGraph`) and aggregates it across explorers into a whole-application
map, adding purpose inference, information architecture, and the unexercised-
affordance surface.
