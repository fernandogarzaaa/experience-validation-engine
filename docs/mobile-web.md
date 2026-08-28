# Mobile Web

EVE can evaluate a site through a genuinely different motor model, not just a
narrower browser window: real device emulation, touch actuation (tap scatter,
swipe momentum, soft-keyboard cadence), and findings that only exist on touch
surfaces (tap-target size, keyboard occlusion, hover-only affordances).

## Why not just resize the viewport?

Resizing a desktop `PlaywrightAdapter` to 390×844 makes a page *look* like a
phone, but the browser still reports itself as a mouse-and-hover surface:
`(hover: hover)` and `(pointer: fine)` media queries still match, and there is
no touch event dispatch. `MobileAdapter` uses Playwright's device descriptors
(`devices["iPhone 14"]`, etc.) via `browser.newContext()`, which flips
`hasTouch`/`isMobile` at the browser level — the same flags a real phone sets.
That's what actually changes how the page behaves, not the window size.

## Usage

```bash
npx playwright install chromium   # Playwright ships with EVE; the browser is fetched once

# CLI
eve run https://your-app.example.com --browser mobile --device "iPhone 14"

# Config file
```

```yaml
url: https://your-app.example.com
browser: mobile
device: iPhone 14   # iPhone 14 | iPhone SE | Pixel 7 | iPad Mini (default: iPhone 14)
```

```ts
// Programmatic
import { EveSession, MobileAdapter, writeReports } from "experience-validation-engine";

const result = await new EveSession({
  adapter: new MobileAdapter({ headless: true, device: "iPhone 14" }),
  startUrl: "https://your-app.example.com",
  persona: "impatient-user",
}).run();
```

The `viewport` option (CLI `--browser`/config `viewport:`) is ignored when the
adapter is `mobile` — emulating "iPhone 14" means using its real viewport, not
an arbitrary desktop size. See `examples/mobile-web.ts` for a full run.

## What's actually different

Everything below flows through the same `BrowserAdapter` contract and the
same `Percept` type as every other adapter — the adapter itself stays dumb
(one tap, one scroll delta, one primitive call at a time). The realism is
composed by the humanizer (`src/browser/humanizer.ts`) and the engine
(`src/engine/session.ts`), which branch on
`adapter.capabilities.pointer === "touch"`.

- **Fat-finger tap scatter** (`planTap`) — wider than mouse-click scatter
  (`planClick`), scaled by persona motor traits, plus a fingertip contact-
  patch radius. It also grows with thumb-reach cost: targets near the top
  corners of the screen are struck less precisely than targets near the
  bottom-center, where a one-handed thumb naturally rests. This models
  one-handed use — the conservative case for a mobile audit.
- **Swipe momentum** (`planSwipe`) — a scroll is planned as a flick plus
  decaying momentum segments, never a single atomic jump. The adapter still
  only ever receives plain `scrollBy(deltaY)` calls, one per segment.
- **Soft-keyboard typing** (`planSoftKeyType`) — slower per-character cadence
  and a higher typo rate than typing with a physical keyboard.
- **No hover** — `TOUCH_VISUAL_SURFACE.canHover` is `false`. If cognition
  decides to hover over something, the engine does not fake a pointer move;
  it skips actuation, and the accessibility plugin turns the attempted hover
  itself into a finding ("Hover-only affordance is unreachable on this
  surface").

## Keyboard occlusion is modeled, not sensed

**No headless browser renders a real on-screen keyboard.** There is nothing
for the adapter to perceive when a soft keyboard would be covering the bottom
of the screen — Playwright's touch emulation flips input semantics, not
visual chrome. So `Percept.keyboardOcclusion` is computed by the observation
layer (`src/observation/perception.ts`), deterministically, from:

- the adapter reporting `capabilities.pointer === "touch"`,
- the adapter's `deviceMetrics.softKeyboardHeightPx` (a per-device constant —
  see `DEVICE_PRESETS` in `src/browser/mobile.ts` — approximating typical
  vendor keyboard heights, portrait, with the predictive-text bar showing),
  and
- whether the current percept has a focused, editable element.

When those hold, `Percept.keyboardOcclusion` is a viewport-relative rect
covering the bottom band, and any element intersecting it gets
`occludedByKeyboard: true`. Treat this exactly as what it is: a documented
model assumption, not a measurement. It surfaces as ordinary findings
(content pushed behind the keyboard) like anything else EVE reports, but if
you're auditing EVE's own honesty, this is the one spot in the mobile adapter
where a number is asserted rather than observed.

`occludedByKeyboard` is a separate field from `VisibleElement.clippedByViewport`
on purpose. `clippedByViewport` is horizontal CSS overflow, computed by the
real perception script from actual layout. `occludedByKeyboard` is a vertical,
dynamic overlay modeled by the observation layer. They have different causes,
different axes, and different sources of truth — folding them into one flag
would make a consumer that checks only one silently miss the other.

## Findings unique to touch surfaces

All gated on `capabilities.pointer === "touch"` in the accessibility plugin
(`src/plugins/accessibility.ts`):

- **Tap targets under 44×44 CSS px** — the widely-used minimum comfortable
  tap-target size.
- **Content covered by the modeled keyboard** — an interactive or textual
  element with `occludedByKeyboard: true`.
- **Hover-only affordances** — cognition attempted to hover on a surface with
  no persistent pointer.

## Scope of this pass

- Always launches Chromium, even for device descriptors that recommend
  WebKit (e.g. iPhones in real life run Safari). This keeps the adapter's
  runtime footprint identical to the desktop `PlaywrightAdapter`.
  Rendering-engine-specific quirks are out of scope.
- Swipe momentum is a geometric decay curve, not a full physics model —
  overscroll/rubber-banding is not simulated.
- `device` is threaded through the CLI, `eve.config.yaml`, and the
  `eve_run_session` MCP tool. It is not (yet) threaded through the study,
  twin, scan, or benchmark MCP tools — those still accept `browser: mobile`
  via the shared `AdapterName`/`BrowserBackend` enum, but always launch the
  default device ("iPhone 14").
