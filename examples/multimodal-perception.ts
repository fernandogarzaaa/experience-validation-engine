/**
 * Phase 3 — Multimodal perception.
 *
 * Beyond text, EVE recognizes higher-level visual constructs from what a human
 * can see: icons, charts, media, loading states, toasts, and text-in-images
 * (and, with real screenshots, animation). It surfaces perception risks —
 * unlabeled visuals that are ambiguous to humans and invisible to screen
 * readers — without ever inspecting source.
 *
 * Run:
 *   npx tsx examples/multimodal-perception.ts
 */

import { EveSession } from "../src/engine/session.js";
import { MockAdapter, type MockAppSpec } from "../src/browser/index.js";
import { analyzeMultimodal, renderMultimodalMarkdown } from "../src/multimodal/index.js";

// A visually rich mock app: a chart, an unlabeled image, an icon-only button,
// a loading state, and a toast.
const app: MockAppSpec = {
  name: "Insights",
  start: "home",
  screens: [
    {
      id: "home",
      title: "Insights dashboard",
      elements: [
        { role: "heading", text: "Insights" },
        { role: "image", text: "Weekly revenue chart trending up" },
        { role: "image", text: "" }, // unlabeled — a perception risk
        { role: "button", text: "", goto: "home" }, // icon-only — a perception risk
        { role: "button", text: "Export report", goto: "export" },
        { role: "progress", text: "" }, // loading state
        { role: "alert", text: "Dashboard updated" }, // toast
      ],
    },
    {
      id: "export",
      title: "Export",
      elements: [
        { role: "heading", text: "Export complete" },
        { role: "alert", text: "Report saved successfully" },
        { role: "button", text: "Back", goto: "home" },
      ],
    },
  ],
};

const result = await new EveSession({
  adapter: new MockAdapter(app), // swap for a real adapter + URL (screenshots enable motion)
  startUrl: "mock:",
  persona: "curious-explorer",
  seed: 7,
  maxSteps: 25,
}).run();

process.stdout.write(renderMultimodalMarkdown(analyzeMultimodal(result)) + "\n");
