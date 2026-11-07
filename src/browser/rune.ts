import { execFile } from "node:child_process";
import { access, constants, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { PNG } from "pngjs";

import type { Point, Viewport, VisibleElement } from "../core/types.js";
import { ADAPTER_VERSION } from "../core/versions.js";
import { VISUAL_SURFACE } from "../surface/capabilities.js";
import type { AdapterOptions, BrowserAdapter, RawSnapshot } from "./adapter.js";

/**
 * Rune adapter — drives a Rune app headlessly through its own CLI.
 *
 * A Rune app is a native Rust UI binary. It has no DOM and no browser, so
 * this adapter talks to it the way Rune's own tooling does: every action is
 * appended to a script journal (timestamped input events) and the app is
 * re-run headlessly to the new virtual time, producing a PNG (`--snap`) and
 * an element-tree dump (`--tree`). A run is deterministic: the same journal
 * renders the same frames, so a session replays identically.
 *
 * There is no persistent Rune session: one process renders one run
 * (see `crates/rune/src/tooling/headless_run.rs` — "a process renders one
 * run"). The journal approach is the consequence, and its cost is one
 * process spawn plus GPU init per action (hundreds of ms on lavapipe). The
 * tradeoff is documented in the spike report; a persistent driver process
 * would need a mode Rune does not ship.
 *
 * Principle 1 (no privileged information) shapes what perception may use.
 * `snapshot()` reports only what a human perceives — rendered visible text
 * and geometry — through `runeTreeToVisibleElements`. The tree dump's
 * internal fields (element `key`, `path`, the accessibility tree's internal
 * states) never reach perception. That boundary follows the same precedent
 * as the Playwright perception script, which reads the DOM and reports only
 * visible text and geometry, marking aria-label fallbacks with
 * `textSource: "accessibility"` so downstream knows a sighted human does
 * not see that text. The full tree dump is kept only for post-run scoring
 * (ground truth: what was really on screen versus what the operator
 * thought it saw); see `recordDir` and the separate grounding script.
 */

const execFileAsync = promisify(execFile);

/** One element of a Rune `--tree` dump (subset this driver reads). */
export interface RuneTreeElement {
  path?: string;
  role?: string;
  rect: [number, number, number, number];
  key?: string;
  label?: string;
  text?: string;
  color?: string;
  fill?: string;
  focusable?: boolean;
  focused?: boolean;
  opacity?: number;
  inert?: boolean;
}

/** A Rune `--tree` dump (subset this driver reads). */
export interface RuneTree {
  title?: string;
  viewport: [number, number];
  scale?: number;
  t?: number;
  elements: RuneTreeElement[];
}

/** One scripted input event, as Rune's `--script` JSON expects. */
export type RuneScriptEvent = Record<string, unknown>;

export interface RuneAdapterOptions extends AdapterOptions {
  /**
   * Directory receiving one PNG + tree JSON + journal snapshot per step,
   * for post-run grounding scoring. Unset disables recording.
   */
  recordDir?: string;
  /** Virtual seconds allowed for springs to settle after an action. */
  settleSeconds?: number;
}

/**
 * Map a Rune tree dump to the elements a human perceives.
 *
 * Retina abstraction, same contract as the Playwright perception script:
 * only what is actually rendered and visible is reported. An element is
 * perceivable when it carries rendered text or is an interactive affordance
 * (focusable). Everything else is excluded: the window background group, a
 * switch's knob sub-part, hidden (`opacity: 0`) or inert elements, and
 * off-viewport content. Internal identifiers (`key`, `path`) and the
 * accessibility tree's internal states are never copied through; the only
 * text that may come from a non-visual source is an element's `label`
 * (its accessible name), reported with `textSource: "accessibility"` —
 * exactly how the perception script treats aria-label fallbacks.
 */
export function runeTreeToVisibleElements(tree: RuneTree): VisibleElement[] {
  const [viewportWidth, viewportHeight] = tree.viewport;
  const out: VisibleElement[] = [];
  let id = 0;
  for (const el of tree.elements ?? []) {
    if (el.opacity !== undefined && el.opacity <= 0) continue;
    if (el.inert) continue;
    const [x, y, width, height] = el.rect;
    if (x >= viewportWidth || y >= viewportHeight || x + width <= 0 || y + height <= 0) continue;
    const text = typeof el.text === "string" ? el.text : "";
    const label = typeof el.label === "string" ? el.label : "";
    const interactive = el.focusable === true || isInteractiveRole(el.role);
    if (!text && !interactive) continue;
    out.push({
      id: id++,
      role: mapRole(el.role),
      text: text || label,
      textSource: text ? "visual" : label ? "accessibility" : "visual",
      box: { x, y, width, height },
      interactive,
      // Inert elements are excluded above, so nothing reported here is disabled.
      disabled: false,
      editable: el.role === "textbox",
      focused: el.focused === true,
      clippedByViewport: x < 0 || y < 0 || x + width > viewportWidth || y + height > viewportHeight,
      color: el.color ? toRgb(el.color) : undefined,
      // A text element's own fill is transparent black (#00000000): it is
      // not the background the text sits on. Reporting it as #000000 made
      // the declared-color check read dark text on black (the name-form
      // "Continue" label flagged 1.13:1 on a blue button). Only a fill with
      // actual opacity is a background; the pixel-sampled check measures the
      // real one instead.
      backgroundColor: el.fill && !isTransparentFill(el.fill) ? toRgb(el.fill) : undefined,
    });
  }
  return out;
}

/** True when a `#rrggbbaa` fill is fully transparent (alpha 00). */
function isTransparentFill(fill: string): boolean {
  return /^#[0-9a-fA-F]{8}$/.test(fill) && fill.slice(7, 9) === "00";
}

function isInteractiveRole(role: string | undefined): boolean {
  return (
    role === "button" ||
    role === "link" ||
    role === "switch" ||
    role === "checkbox" ||
    role === "radio" ||
    role === "slider" ||
    role === "textbox" ||
    role === "tab" ||
    role === "menuitem" ||
    role === "select"
  );
}

function mapRole(role: string | undefined): VisibleElement["role"] {
  switch (role) {
    case "text":
      return "text";
    case "button":
      return "button";
    case "link":
      return "link";
    case "textbox":
    case "text-field":
      return "textbox";
    case "checkbox":
      return "checkbox";
    // A switch is a toggle; "checkbox" is the closest coarse perceived role.
    case "switch":
      return "checkbox";
    case "radio":
      return "radio";
    case "slider":
      return "slider";
    case "heading":
      return "heading";
    case "image":
      return "image";
    case "dialog":
      return "dialog";
    case "progress":
      return "progress";
    case "table":
      return "table";
    case "tab":
      return "tab";
    case "menuitem":
      return "menuitem";
    case "select":
      return "select";
    case "listitem":
      return "listitem";
    case "alert":
      return "alert";
    default:
      return "unknown";
  }
}

/** `#rrggbbaa` (or `#rrggbb`) to the `#rrggbb` VisibleElement carries. */
function toRgb(color: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return `#${color.slice(1, 7)}`;
  return color;
}

/**
 * Downscale a headless Rune PNG to the viewport the tree reports.
 *
 * Rune renders at the display scale (2x in this sandbox), so the raw PNG is
 * larger than the viewport and its pixels do not line up with the tree's
 * point coordinates. Every pixel check in EVE samples element boxes in
 * points, so a 2x screenshot makes them sample the wrong region: the hello
 * switch label read 1.00:1 and the name-form "Continue" label 1.10:1 this
 * way. A box average keeps the downscale deterministic, so identical
 * journals still replay to identical bytes.
 */
export function downscaleToViewport(png: Buffer, viewport: [number, number]): Buffer {
  const image = PNG.sync.read(png);
  const [width, height] = viewport;
  if (image.width === width && image.height === height) return png;
  const out = new PNG({ width, height });
  const scaleX = image.width / width;
  const scaleY = image.height / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * scaleX));
      const y0 = Math.floor(y * scaleY);
      const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * scaleY));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < image.height; sy++) {
        for (let sx = x0; sx < x1 && sx < image.width; sx++) {
          const i = (sy * image.width + sx) * 4;
          r += image.data[i] ?? 0;
          g += image.data[i + 1] ?? 0;
          b += image.data[i + 2] ?? 0;
          a += image.data[i + 3] ?? 0;
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out);
}

export class RuneAdapter implements BrowserAdapter {
  readonly name = "rune";
  readonly version = ADAPTER_VERSION;
  /**
   * A visual surface like a browser, but a single-screen app: no history to
   * go back through and no scrollable content in the apps this driver runs,
   * so goBack/scroll are documented no-ops and the capabilities say so.
   */
  readonly capabilities = { ...VISUAL_SURFACE, canGoBack: false, canScroll: false } as const;

  private binary = "";
  private workdir = "";
  private journal: RuneScriptEvent[] = [];
  private virtualTime = 0;
  private lastPng: Buffer | null = null;
  private lastTree: RuneTree | null = null;
  private lastRunWallMs: number | null = null;
  private recordStep = 0;
  private opened = false;
  private readonly options: RuneAdapterOptions;

  constructor(options: RuneAdapterOptions = {}) {
    this.options = options;
    if (options.runeBinary) this.binary = options.runeBinary;
  }

  async open(url: string, _viewport: Viewport): Promise<void> {
    const fromUrl = url.startsWith("rune:") ? url.slice("rune:".length) : "";
    const binary = fromUrl || this.binary;
    if (!binary) {
      throw new Error(
        "RuneAdapter: no Rune app binary configured. Pass rune:<path-to-binary> as the URL " +
          "or set runeBinary in the config.",
      );
    }
    try {
      await access(binary, constants.X_OK);
    } catch {
      throw new Error(`RuneAdapter: Rune app binary is not executable or not found: ${binary}`);
    }
    this.binary = binary;
    if (this.workdir) await rm(this.workdir, { recursive: true, force: true });
    this.workdir = await mkdtemp(join(tmpdir(), "eve-rune-"));
    this.journal = [];
    this.virtualTime = 0;
    this.recordStep = 0;
    await this.run();
    this.opened = true;
  }

  async snapshot(): Promise<RawSnapshot> {
    const tree = this.requireTree();
    const [width, height] = tree.viewport;
    return {
      url: `rune://${basename(this.binary)}`,
      title: tree.title ?? basename(this.binary),
      viewport: { width, height },
      scrollY: 0,
      scrollHeight: height,
      elements: runeTreeToVisibleElements(tree),
      dialogs: [],
      loadingIndicator: false,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    return this.lastPng;
  }

  async moveMouse(_point: Point): Promise<void> {
    // Pointer position only matters as part of the next click, and a click
    // event moves the pointer to its target first; a lone move changes no
    // app state, so there is nothing to re-run for.
  }

  async clickAt(point: Point): Promise<void> {
    const t = this.virtualTime + 0.1;
    this.journal.push({ t, type: "click", x: point.x, y: point.y });
    this.virtualTime = t + (this.options.settleSeconds ?? 1.0);
    await this.run();
  }

  async doubleClickAt(point: Point): Promise<void> {
    const t = this.virtualTime + 0.1;
    this.journal.push({ t, type: "double-click", x: point.x, y: point.y });
    this.virtualTime = t + (this.options.settleSeconds ?? 1.0);
    await this.run();
  }

  async typeText(text: string, perCharIntervalMs: number): Promise<void> {
    const t = this.virtualTime + 0.1;
    const every = Math.max(perCharIntervalMs, 1) / 1000;
    this.journal.push({ t, type: "type", text, every });
    this.virtualTime = t + text.length * every + 0.5;
    await this.run();
  }

  async pressKey(key: string): Promise<void> {
    const t = this.virtualTime + 0.1;
    this.journal.push({ t, type: "key", name: key });
    this.virtualTime = t + 0.5;
    await this.run();
  }

  async scrollBy(_deltaY: number): Promise<void> {
    // No-op: the apps this driver runs have no scrollable content.
  }

  async goBack(): Promise<void> {
    // No-op: a single-screen Rune app has no navigation history.
  }

  async navigate(url: string): Promise<void> {
    if (!url.startsWith("rune:")) {
      throw new Error(`RuneAdapter: cannot navigate to non-Rune URL: ${url}`);
    }
    await this.open(url, { width: 0, height: 0 });
  }

  async close(): Promise<void> {
    this.opened = false;
    this.lastPng = null;
    this.lastTree = null;
    if (this.workdir) {
      await rm(this.workdir, { recursive: true, force: true });
      this.workdir = "";
    }
  }

  lastWaitMs(): number | null {
    const ms = this.lastRunWallMs;
    this.lastRunWallMs = null;
    return ms;
  }

  /**
   * Re-run the app headlessly with the full journal to the current virtual
   * time, refreshing the cached PNG and tree. Deterministic: the same
   * journal renders the same frames.
   */
  private async run(): Promise<void> {
    if (!this.binary || !this.workdir) throw new Error("RuneAdapter: call open() first");
    const scriptPath = join(this.workdir, "script.json");
    const snapPath = join(this.workdir, "snap.png");
    const treePath = join(this.workdir, "tree.json");
    await writeFile(scriptPath, JSON.stringify(this.journal));
    const args = [
      ...(this.journal.length > 0 ? ["--script", scriptPath] : []),
      "--snap",
      snapPath,
      "--tree",
      treePath,
      "--at",
      this.virtualTime.toFixed(3),
    ];
    const started = Date.now();
    try {
      await execFileAsync(this.binary, args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `RuneAdapter: headless run failed (${this.binary} ${args.join(" ")}): ${detail}`,
      );
    }
    this.lastRunWallMs = Date.now() - started;
    this.lastPng = await readFile(snapPath);
    this.lastTree = JSON.parse(await readFile(treePath, "utf8")) as RuneTree;
    this.lastPng = downscaleToViewport(this.lastPng, this.lastTree.viewport);
    if (this.options.recordDir) await this.record();
  }

  /** Save this step's PNG, tree and journal for post-run grounding scoring. */
  private async record(): Promise<void> {
    const dir = this.options.recordDir!;
    await mkdir(dir, { recursive: true });
    const n = this.recordStep++;
    await writeFile(join(dir, `step-${n}.png`), this.lastPng!);
    await writeFile(join(dir, `step-${n}.json`), JSON.stringify(this.lastTree, null, 2));
    await writeFile(
      join(dir, `step-${n}.journal.json`),
      JSON.stringify({ virtualTime: this.virtualTime, journal: this.journal }, null, 2),
    );
  }

  private requireTree(): RuneTree {
    if (!this.opened || !this.lastTree) throw new Error("RuneAdapter: call open() first");
    return this.lastTree;
  }
}
