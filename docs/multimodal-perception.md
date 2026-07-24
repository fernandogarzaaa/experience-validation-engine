# Multimodal Perception (Phase 3)

EVE's "retina" already turns a rendered screen into visible elements with roles
and text. Multimodal perception adds a layer on top: recognizing higher-level
**visual constructs** a human sees at a glance — icons, charts, media, loading
states, toasts/notifications, text-in-images, and (with real screenshots)
animation.

Crucially, it stays inside the **human-perception boundary**: cues come only
from what is rendered and visible, never from the DOM, routes, or source.

```ts
import { EveSession, PlaywrightAdapter, analyzeMultimodal, renderMultimodalMarkdown } from "experience-validation-engine";

const result = await new EveSession({
  adapter: new PlaywrightAdapter({ headless: true }),
  startUrl: "https://staging.example.com",
  persona: "curious-explorer",
  screenshots: true, // enables motion/animation detection
}).run();

console.log(renderMultimodalMarkdown(analyzeMultimodal(result)));
```

## Cue kinds

`icon`, `chart`, `media`, `loading`, `toast`, `text-in-image`, `animation`.

## What it reports (`MultimodalReport`)

- `byKind` — counts of each cue kind across all perceived screens
- `screensWithLoading` — how many screens showed a loading state
- `toasts` — transient notifications observed, with their text and screen
- `unlabeled` — **perception risks**: icons, charts, and images with no
  accessible label — ambiguous to humans and invisible to screen readers

## Extending perception (OCR / vision-language models)

The `MultimodalPerceptor` interface is the extension point. The default
`HeuristicMultimodalPerceptor` derives cues deterministically from the rendered
elements, loading indicator, and dialogs (and frame diffs when screenshots are
present). A richer backend — an OCR engine or a vision-language model reading
the screenshot — can implement the same `perceive(percept, previous?)`
interface and be dropped into `analyzeScreens(screens, perceptor)`, as long as
it too only reads what a human could see.

## Via MCP

`eve_multimodal_scan` explores an app and returns the multimodal report — so an
AI coding agent can catch unlabeled charts/icons and loading/toast behaviour
before shipping. See [integrations.md](integrations.md).
