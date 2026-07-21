/**
 * Writing a plugin: a "tone of voice" reviewer that flags shouty all-caps
 * labels and jargon the persona wouldn't understand.
 *
 *   npx tsx examples/custom-plugin.ts
 */
import {
  EveSession,
  MockAdapter,
  DEMO_APP,
  type EvePlugin,
  type PluginContext,
  type Percept,
} from "../src/index.js";

const JARGON = /\b(oauth|webhook|regex|payload|schema|token|sdk)\b/i;

class ToneOfVoicePlugin implements EvePlugin {
  readonly name = "tone-of-voice";
  private readonly seen = new Set<string>();

  async onPercept(ctx: PluginContext, percept: Percept): Promise<void> {
    if (this.seen.has(percept.url)) return;
    this.seen.add(percept.url);

    for (const el of percept.elements) {
      const text = el.text.trim();
      if (text.length > 6 && text === text.toUpperCase() && /[A-Z]{4,}/.test(text)) {
        ctx.report({
          severity: "minor",
          category: "content",
          title: `Shouty all-caps copy: "${text.slice(0, 40)}"`,
          description: "All-caps copy reads as shouting and is harder to scan.",
          evidence: [`Element role: ${el.role}`],
          url: percept.url,
          recommendation: "Use sentence case; reserve caps for tiny labels.",
        });
      }
      if (ctx.persona.traits.techLiteracy < 0.4 && JARGON.test(text)) {
        ctx.report({
          severity: "minor",
          category: "content",
          title: `Jargon this user won't understand: "${text.slice(0, 40)}"`,
          description: `The persona (${ctx.persona.name}) has low tech literacy; terms like this exclude them.`,
          evidence: [],
          url: percept.url,
          recommendation: "Use plain language, or explain terms inline.",
        });
      }
    }
  }
}

const session = new EveSession({
  adapter: new MockAdapter(DEMO_APP),
  // Start on the pricing screen, whose copy is deliberately flawed in the
  // demo app (shouty caps, jargon, tiny low-contrast text).
  startUrl: "mock:pricing",
  persona: "non-technical-user",
  seed: 8,
  maxSteps: 15,
  paceScale: 0,
  plugins: [new ToneOfVoicePlugin()],
});

const result = await session.run();
console.log(`Findings (${result.findings.length}):`);
for (const f of result.findings) console.log(`  [${f.severity}] ${f.title}`);
