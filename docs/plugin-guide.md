# Plugin Guide

Plugins add domain-specific judgment to a session without influencing the
operator's behavior. They observe percepts and outcomes and report findings;
they can never steer the simulation — which keeps runs comparable whether or
not a plugin is enabled.

## The contract

```ts
import type { EvePlugin, PluginContext, Percept, PredictionOutcome, LoopIteration }
  from "experience-validation-engine";

class MyPlugin implements EvePlugin {
  readonly name = "my-plugin";

  onRegister(registries: EveRegistries) {}  // vocabulary registration (optional)
  async onSessionStart(ctx: PluginContext) {}
  async onPercept(ctx: PluginContext, percept: Percept, step: number) {}
  async onOutcome(ctx: PluginContext, outcome: PredictionOutcome, percept: Percept, step: number) {}
  async onSessionEnd(ctx: PluginContext, iterations: readonly LoopIteration[]) {}
}
```

All hooks are optional. `PluginContext` provides:

- `persona` — the active persona (adjust judgments to the user population).
- `startUrl` — the session's entry point.
- `report(finding)` — contribute a finding. `id` and `timestamp` are filled
  in by the engine; findings are deduplicated on `(title, url)`.

Plugin errors are caught and logged; a throwing plugin never breaks a session.

## Registering new vocabulary

Score dimensions, finding categories and action verbs were closed union
types; they are now registries (`src/core/registry.ts`) with the shipped
values pre-registered as built-ins. `onRegister` runs once when the plugin is
registered — before any session — and is the one place a plugin may widen a
vocabulary:

```ts
onRegister({ dimensions, findingCategories, actionVerbs }: EveRegistries) {
  dimensions.register({
    id: "saas.tenantIsolation",
    builtin: false,
    weight: 0,                          // never reweights existing composites
    appliesTo: ["visual", "textual"],   // modality gating (honesty layer)
    evidenceRequired: true,             // not negotiable
  });
}
```

Registered values serialize as plain strings, exactly like the built-ins, so
report formats and CP/1 documents are unaffected. Custom action verbs are
always engine-side: the CP/1 canonical verb set (`ExperienceAction`) is
closed on the wire and can only grow with a protocol version change.

## A complete example

```ts
class ToneOfVoicePlugin implements EvePlugin {
  readonly name = "tone-of-voice";
  private readonly seen = new Set<string>();

  async onPercept(ctx: PluginContext, percept: Percept) {
    if (this.seen.has(percept.url)) return;   // once per screen
    this.seen.add(percept.url);

    for (const el of percept.elements) {
      const text = el.text.trim();
      if (text.length > 6 && text === text.toUpperCase()) {
        ctx.report({
          severity: "minor",
          category: "content",
          title: `Shouty all-caps copy: "${text.slice(0, 40)}"`,
          description: "All-caps copy reads as shouting and is harder to scan.",
          evidence: [`Element role: ${el.role}`],
          url: percept.url,
          recommendation: "Use sentence case.",
        });
      }
    }
  }
}
```

Register it:

```ts
new EveSession({ ..., plugins: [new ToneOfVoicePlugin()] });
```

Runnable version: `examples/custom-plugin.ts`.

## Built-in plugins

| Plugin | What it judges |
|---|---|
| `AccessibilityPlugin` | Unlabeled images/controls, missing keyboard focus for keyboard-only personas (contrast/text-size checks live in the vision module and run always) |
| `PerformancePlugin` | Per-action perceived waits > 3s; session p90 latency |
| `LlmCriticPlugin` | Optional Anthropic-powered design review of each unique screen (screenshot + visible text → structured critique). Needs `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`; silently inert otherwise. |

## Design guidelines

1. **Judge perception, not implementation.** You receive what the user saw.
   Resist the urge to fetch DOM/network data — that breaks EVE's core
   contract and your findings would describe code, not experience.
2. **Rate-limit yourself.** `onPercept` fires every step; cache per-URL or
   per-signature like the built-ins do.
3. **Findings need evidence.** Empty `evidence` arrays make reports
   unfalsifiable; include the concrete observation that triggered you.
4. **Severity discipline**: `critical` = users will churn; `major` = users
   will struggle or fail; `minor` = polish. `info` = observation.
5. **Persona-relative judgment is encouraged** — jargon is a finding for a
   `non-technical-user`, not for a `developer-as-customer`.

## Future plugin ideas (see ROADMAP)

Vision AI (model-based screenshot understanding), design-system conformance,
localization completeness, security-UX (deceptive-pattern detection),
analytics-instrumentation coverage.
