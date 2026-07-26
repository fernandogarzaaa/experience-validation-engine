# Non-Visual Surface Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let EVE validate the experience of headless tools (CLIs, proxies, MCP servers) by adding a surface-capability flag and a CLI/process adapter, so non-visual surfaces produce honest findings instead of fabricated pixel geometry.

**Architecture:** Adapters declare a `SurfaceCapabilities` descriptor. A shared text-frame layout engine converts terminal output into `VisibleElement[]` using real character-cell geometry. A `CliAdapter` spawns a process and perceives its output. Checks that assume pixels are gated behind `capabilities.spatial` and are skipped — not failed — for textual surfaces. Nothing downstream of `Percept` changes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, Node `child_process`.

## Global Constraints

- Import specifiers use the `.js` extension even for `.ts` sources (ESM NodeNext), e.g. `import type { Percept } from "../core/types.js"`.
- Tests live flat in `tests/<name>.test.ts`. Run with `npm test` (`vitest run`).
- Typecheck with `npm run typecheck` (`tsc --noEmit`). Must stay clean.
- All new `VisibleElement` objects must satisfy the existing interface in `src/core/types.ts`: `id`, `role`, `text`, `box`, `interactive`, `disabled`, `editable`, `focused`, `clippedByViewport` are required; `color`, `backgroundColor`, `fontSize` are optional and MUST be omitted for textual surfaces.
- Adapters must not expose privileged information. A textual adapter may perceive only what the process prints to stdout/stderr — never source code, internal state, or network traffic.
- Coverage target 80%.
- Existing browser adapters must keep working unchanged; every change is additive.

---

### Task 1: Surface capabilities descriptor

**Files:**
- Create: `src/surface/capabilities.ts`
- Modify: `src/browser/adapter.ts` (add `capabilities` to `BrowserAdapter`)
- Modify: `src/browser/mock.ts`, `src/browser/playwright.ts`, `src/browser/puppeteer.ts`, `src/browser/selenium.ts` (declare `capabilities`)
- Test: `tests/surfaceCapabilities.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `SurfaceCapabilities`, `VISUAL_SURFACE`, `TEXTUAL_SURFACE` from `src/surface/capabilities.js`; `BrowserAdapter.capabilities` readonly property.

- [ ] **Step 1: Write the failing test**

Create `tests/surfaceCapabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VISUAL_SURFACE, TEXTUAL_SURFACE } from "../src/surface/capabilities.js";
import { MockAdapter } from "../src/browser/mock.js";

describe("surface capabilities", () => {
  it("describes a visual surface as spatial and screenshot-capable", () => {
    expect(VISUAL_SURFACE.spatial).toBe(true);
    expect(VISUAL_SURFACE.modality).toBe("visual");
    expect(VISUAL_SURFACE.canScreenshot).toBe(true);
  });

  it("describes a textual surface as non-spatial with no screenshots", () => {
    expect(TEXTUAL_SURFACE.spatial).toBe(false);
    expect(TEXTUAL_SURFACE.modality).toBe("textual");
    expect(TEXTUAL_SURFACE.canScreenshot).toBe(false);
  });

  it("exposes capabilities on the shipped mock adapter", () => {
    const adapter = new MockAdapter();
    expect(adapter.capabilities.spatial).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/surfaceCapabilities.test.ts`
Expected: FAIL — cannot resolve module `../src/surface/capabilities.js`.

- [ ] **Step 3: Create the capabilities module**

Create `src/surface/capabilities.ts`:

```ts
/**
 * What kind of surface an adapter perceives.
 *
 * EVE's cognition is modality-agnostic — it reasons over a Percept. This
 * descriptor tells the reporting and plugin layers which perceptual
 * dimensions are meaningful, so a textual surface is never scored as if it
 * failed a visual audit.
 */
export interface SurfaceCapabilities {
  /** Pixel geometry and visual styling (font size, color, contrast) are meaningful. */
  readonly spatial: boolean;
  readonly modality: "visual" | "textual";
  readonly canScreenshot: boolean;
  readonly canGoBack: boolean;
  readonly canScroll: boolean;
}

/** A rendered browser page: full pixel geometry and styling. */
export const VISUAL_SURFACE: SurfaceCapabilities = {
  spatial: true,
  modality: "visual",
  canScreenshot: true,
  canGoBack: true,
  canScroll: true,
};

/**
 * A text surface (terminal, tool listing). Character-cell geometry is real,
 * but there is no font size, color, or screenshot to perceive.
 */
export const TEXTUAL_SURFACE: SurfaceCapabilities = {
  spatial: false,
  modality: "textual",
  canScreenshot: false,
  canGoBack: false,
  canScroll: true,
};
```

- [ ] **Step 4: Add `capabilities` to the adapter contract**

In `src/browser/adapter.ts`, add this import at the top:

```ts
import type { SurfaceCapabilities } from "../surface/capabilities.js";
```

Then add this property as the first member of the `BrowserAdapter` interface, directly after `readonly name: string;`:

```ts
  /** Which perceptual dimensions this surface actually has. */
  readonly capabilities: SurfaceCapabilities;
```

Also add this alias at the end of the file, to signal intent without a breaking rename:

```ts
/** Adapters are not browser-specific; this alias names the general contract. */
export type SurfaceAdapter = BrowserAdapter;
```

- [ ] **Step 5: Declare capabilities on all four shipped adapters**

In each of `src/browser/mock.ts`, `src/browser/playwright.ts`, `src/browser/puppeteer.ts`, and `src/browser/selenium.ts`, add the import:

```ts
import { VISUAL_SURFACE } from "../surface/capabilities.js";
```

and add this line to the class body immediately after its existing `readonly name = "...";` declaration:

```ts
  readonly capabilities = VISUAL_SURFACE;
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/surfaceCapabilities.test.ts`
Expected: PASS (3 tests).

Run: `npm run typecheck`
Expected: no output, exit 0. If a class implementing `BrowserAdapter` is missing `capabilities`, tsc reports it here — add the property to that class.

- [ ] **Step 7: Run the full suite for non-regression**

Run: `npm test`
Expected: all pre-existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/surface/capabilities.ts src/browser tests/surfaceCapabilities.test.ts
git commit -m "feat: add surface capabilities descriptor to adapter contract"
```

---

### Task 2: Text-frame layout engine

**Files:**
- Create: `src/surface/textFrame.ts`
- Test: `tests/textFrame.test.ts`

**Interfaces:**
- Consumes: `VisibleElement`, `PerceivedRole`, `Viewport` from `src/core/types.js`.
- Produces: `CELL_WIDTH`, `LINE_HEIGHT`, `TextAffordance`, `TextFrame`, `LaidOutFrame`, `layoutTextFrame(frame: TextFrame): LaidOutFrame` from `src/surface/textFrame.js`.

- [ ] **Step 1: Write the failing test**

Create `tests/textFrame.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CELL_WIDTH, LINE_HEIGHT, layoutTextFrame } from "../src/surface/textFrame.js";

describe("layoutTextFrame", () => {
  it("places each line at its row using character-cell geometry", () => {
    const out = layoutTextFrame({
      lines: ["hello", "world"],
      affordances: [],
      windowRows: 24,
      scrollLine: 0,
    });
    expect(out.elements).toHaveLength(2);
    expect(out.elements[0].box).toEqual({ x: 0, y: 0, width: 5 * CELL_WIDTH, height: LINE_HEIGHT });
    expect(out.elements[1].box.y).toBe(LINE_HEIGHT);
    expect(out.elements[1].text).toBe("world");
  });

  it("omits visual-only properties entirely", () => {
    const out = layoutTextFrame({ lines: ["x"], affordances: [], windowRows: 24, scrollLine: 0 });
    expect(out.elements[0].fontSize).toBeUndefined();
    expect(out.elements[0].color).toBeUndefined();
    expect(out.elements[0].backgroundColor).toBeUndefined();
  });

  it("marks affordances interactive and positions them by column", () => {
    const out = layoutTextFrame({
      lines: ["try: npm install"],
      affordances: [{ line: 0, column: 5, text: "npm install", role: "button", command: "npm install" }],
      windowRows: 24,
      scrollLine: 0,
    });
    const affordance = out.elements.find((el) => el.interactive);
    expect(affordance).toBeDefined();
    expect(affordance!.text).toBe("npm install");
    expect(affordance!.box.x).toBe(5 * CELL_WIDTH);
  });

  it("skips blank lines and reports scrollHeight over all lines", () => {
    const out = layoutTextFrame({
      lines: ["a", "   ", "b"],
      affordances: [],
      windowRows: 24,
      scrollLine: 0,
    });
    expect(out.elements).toHaveLength(2);
    expect(out.scrollHeight).toBe(3 * LINE_HEIGHT);
  });

  it("clips lines below the visible window", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const out = layoutTextFrame({ lines, affordances: [], windowRows: 10, scrollLine: 0 });
    expect(out.elements[0].clippedByViewport).toBe(false);
    expect(out.elements[20].clippedByViewport).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/textFrame.test.ts`
Expected: FAIL — cannot resolve `../src/surface/textFrame.js`.

- [ ] **Step 3: Implement the layout engine**

Create `src/surface/textFrame.ts`:

```ts
import type { PerceivedRole, VisibleElement, Viewport } from "../core/types.js";

/**
 * Text-frame layout.
 *
 * A terminal is not a fake screen: text genuinely occupies rows and columns,
 * so character-cell geometry is an honest BoundingBox. What a textual surface
 * lacks is pixel-visual styling — font size, color, contrast — so those
 * optional properties are omitted rather than invented.
 */

/** Nominal width of one character cell, in CSS pixels. */
export const CELL_WIDTH = 8;
/** Nominal height of one text row, in CSS pixels. */
export const LINE_HEIGHT = 18;

/** Something the operator can act on next. */
export interface TextAffordance {
  readonly line: number;
  readonly column: number;
  readonly text: string;
  readonly role: PerceivedRole;
  /** The command to run when this affordance is actuated. */
  readonly command?: string;
}

export interface TextFrame {
  readonly lines: readonly string[];
  readonly affordances: readonly TextAffordance[];
  /** How many rows the operator can see at once. */
  readonly windowRows: number;
  /** Index of the topmost visible line. */
  readonly scrollLine: number;
}

export interface LaidOutFrame {
  readonly elements: VisibleElement[];
  readonly viewport: Viewport;
  readonly scrollY: number;
  readonly scrollHeight: number;
}

const MAX_COLUMNS = 120;

export function layoutTextFrame(frame: TextFrame): LaidOutFrame {
  const elements: VisibleElement[] = [];
  let id = 0;

  const affordanceLines = new Set(frame.affordances.map((a) => a.line));
  const lastVisibleLine = frame.scrollLine + frame.windowRows;

  frame.lines.forEach((line, index) => {
    if (!line.trim()) return;
    // An affordance renders its own element; skip the plain-text duplicate.
    if (affordanceLines.has(index)) return;
    elements.push({
      id: id++,
      role: "text",
      text: line.trim(),
      box: {
        x: 0,
        y: index * LINE_HEIGHT,
        width: line.trim().length * CELL_WIDTH,
        height: LINE_HEIGHT,
      },
      interactive: false,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: index < frame.scrollLine || index >= lastVisibleLine,
    });
  });

  for (const affordance of frame.affordances) {
    elements.push({
      id: id++,
      role: affordance.role,
      text: affordance.text,
      box: {
        x: affordance.column * CELL_WIDTH,
        y: affordance.line * LINE_HEIGHT,
        width: affordance.text.length * CELL_WIDTH,
        height: LINE_HEIGHT,
      },
      interactive: true,
      disabled: false,
      editable: affordance.role === "textbox",
      focused: false,
      clippedByViewport:
        affordance.line < frame.scrollLine || affordance.line >= lastVisibleLine,
    });
  }

  return {
    elements,
    viewport: { width: MAX_COLUMNS * CELL_WIDTH, height: frame.windowRows * LINE_HEIGHT },
    scrollY: frame.scrollLine * LINE_HEIGHT,
    scrollHeight: frame.lines.length * LINE_HEIGHT,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/textFrame.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/surface/textFrame.ts tests/textFrame.test.ts
git commit -m "feat: add text-frame layout with character-cell geometry"
```

---

### Task 3: Affordance detection

**Files:**
- Create: `src/surface/affordances.ts`
- Test: `tests/affordances.test.ts`

**Interfaces:**
- Consumes: `TextAffordance` from `src/surface/textFrame.js`.
- Produces: `stripAnsi(text: string): string` and `detectAffordances(lines: readonly string[]): TextAffordance[]` from `src/surface/affordances.js`.

This is the perception problem that makes the adapter a real DX instrument: a CLI that tells you what to do next has affordances; one that dumps a bare stack trace has none, and cognition correctly perceives a dead end.

- [ ] **Step 1: Write the failing test**

Create `tests/affordances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectAffordances, stripAnsi } from "../src/surface/affordances.js";

describe("stripAnsi", () => {
  it("removes color escape sequences", () => {
    expect(stripAnsi("[31merror[0m")).toBe("error");
  });
});

describe("detectAffordances", () => {
  it("finds a backtick-quoted command", () => {
    const found = detectAffordances(["Run `npm install` to fix this."]);
    expect(found).toHaveLength(1);
    expect(found[0].command).toBe("npm install");
    expect(found[0].role).toBe("button");
    expect(found[0].line).toBe(0);
  });

  it("finds an interactive prompt as an editable affordance", () => {
    const found = detectAffordances(["Enter your name: "]);
    expect(found).toHaveLength(1);
    expect(found[0].role).toBe("textbox");
  });

  it("finds subcommands in a help listing", () => {
    const found = detectAffordances(["Commands:", "  start    Start the proxy", "  stop     Stop it"]);
    expect(found.map((a) => a.command)).toEqual(["start", "stop"]);
  });

  it("returns nothing for a bare stack trace", () => {
    const found = detectAffordances([
      "Error: ENOENT: no such file or directory",
      "    at Object.openSync (node:fs:600:3)",
      "    at readFileSync (node:fs:468:35)",
    ]);
    expect(found).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/affordances.test.ts`
Expected: FAIL — cannot resolve `../src/surface/affordances.js`.

- [ ] **Step 3: Implement detection**

Create `src/surface/affordances.ts`:

```ts
import type { TextAffordance } from "./textFrame.js";

/** Strip ANSI escape sequences so perceived text matches what a human reads. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*[A-Za-z]/g, "");
}

const BACKTICK_COMMAND = /`([^`]+)`/;
const PROMPT = /[:?]\s*$/;
const HELP_ENTRY = /^\s{2,}([a-z][\w:-]*)\s{2,}\S/;
const STACK_FRAME = /^\s+at\s/;

/**
 * Detect what the operator can act on next. Three affordance kinds:
 * a command the output suggests, a documented subcommand in a help
 * listing, and a prompt awaiting input.
 *
 * Order matters: a help entry is checked before the prompt heuristic so a
 * section header like "Commands:" does not masquerade as an input prompt.
 */
export function detectAffordances(lines: readonly string[]): TextAffordance[] {
  const found: TextAffordance[] = [];
  let sawHelpEntry = false;

  lines.forEach((raw, line) => {
    const text = stripAnsi(raw);
    if (STACK_FRAME.test(text)) return;

    const backtick = BACKTICK_COMMAND.exec(text);
    if (backtick) {
      found.push({
        line,
        column: backtick.index + 1,
        text: backtick[1],
        role: "button",
        command: backtick[1],
      });
      return;
    }

    const help = HELP_ENTRY.exec(text);
    if (help) {
      sawHelpEntry = true;
      found.push({
        line,
        column: text.indexOf(help[1]),
        text: help[1],
        role: "menuitem",
        command: help[1],
      });
      return;
    }

    // A trailing-colon line is only a prompt when it is not a section header
    // introducing a help listing.
    const isSectionHeader = /^[A-Z][\w ]*:\s*$/.test(text);
    if (text.trim() && PROMPT.test(text) && !isSectionHeader) {
      found.push({ line, column: 0, text: text.trim(), role: "textbox" });
    }
  });

  void sawHelpEntry;
  return found;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/affordances.test.ts`
Expected: PASS (5 tests).

If the help-listing test returns an extra entry for `Commands:`, the `isSectionHeader` guard did not match — widen it to allow a trailing space before the colon and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/surface/affordances.ts tests/affordances.test.ts
git commit -m "feat: detect CLI affordances from terminal output"
```

---

### Task 4: CLI process adapter

**Files:**
- Create: `src/surface/cli.ts`
- Create: `tests/fixtures/friendly-cli.mjs`
- Create: `tests/fixtures/hostile-cli.mjs`
- Test: `tests/cliAdapter.test.ts`

**Interfaces:**
- Consumes: `BrowserAdapter`, `RawSnapshot` from `src/browser/adapter.js`; `TEXTUAL_SURFACE` from `src/surface/capabilities.js`; `layoutTextFrame`, `LINE_HEIGHT`, `TextAffordance` from `src/surface/textFrame.js`; `detectAffordances`, `stripAnsi` from `src/surface/affordances.js`.
- Produces: `CliAdapter` class from `src/surface/cli.js`, constructed as `new CliAdapter({ cwd?: string; windowRows?: number })`, opened with a `cli:<command>` URL.

- [ ] **Step 1: Write the fixtures**

Create `tests/fixtures/friendly-cli.mjs`:

```js
console.log("axiom-proxy 0.3.1");
console.log("Proxy is not running.");
console.log("Run `restart-proxy` to start it.");
```

Create `tests/fixtures/hostile-cli.mjs`:

```js
console.error("Error: ENOENT: no such file or directory, open 'axiom.env'");
console.error("    at Object.openSync (node:fs:600:3)");
console.error("    at readFileSync (node:fs:468:35)");
process.exit(1);
```

- [ ] **Step 2: Write the failing test**

Create `tests/cliAdapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CliAdapter } from "../src/surface/cli.js";

const VIEWPORT = { width: 960, height: 432 };

describe("CliAdapter", () => {
  it("declares a textual, non-spatial surface", () => {
    expect(new CliAdapter().capabilities.spatial).toBe(false);
    expect(new CliAdapter().capabilities.modality).toBe("textual");
  });

  it("perceives process output as a text frame", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    const text = snapshot.elements.map((el) => el.text).join(" ");
    expect(text).toContain("Proxy is not running.");
    await adapter.close();
  });

  it("exposes a suggested command as an interactive affordance", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    const actionable = snapshot.elements.filter((el) => el.interactive);
    expect(actionable.map((el) => el.text)).toContain("restart-proxy");
    await adapter.close();
  });

  it("presents a bare stack trace as a dead end with no affordances", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/hostile-cli.mjs", VIEWPORT);
    const snapshot = await adapter.snapshot();
    expect(snapshot.elements.filter((el) => el.interactive)).toHaveLength(0);
    await adapter.close();
  });

  it("never produces a screenshot", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node tests/fixtures/friendly-cli.mjs", VIEWPORT);
    expect(await adapter.screenshot()).toBeNull();
    await adapter.close();
  });

  it("rejects when the binary does not exist", async () => {
    const adapter = new CliAdapter();
    await expect(
      adapter.open("cli:definitely-not-a-real-binary-xyz", VIEWPORT),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/cliAdapter.test.ts`
Expected: FAIL — cannot resolve `../src/surface/cli.js`.

- [ ] **Step 4: Implement the adapter**

Create `src/surface/cli.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BrowserAdapter, RawSnapshot } from "../browser/adapter.js";
import type { Point, Viewport } from "../core/types.js";
import { TEXTUAL_SURFACE } from "./capabilities.js";
import { LINE_HEIGHT, layoutTextFrame, type TextAffordance } from "./textFrame.js";
import { detectAffordances, stripAnsi } from "./affordances.js";

const DEFAULT_WINDOW_ROWS = 24;
const SETTLE_MS = 50;

export interface CliAdapterOptions {
  cwd?: string;
  windowRows?: number;
}

/**
 * CliAdapter — perceives a command-line tool.
 *
 * For a terminal user, console output IS the screen. This adapter perceives
 * only what the process prints; it never inspects source, internals, or
 * network traffic.
 */
export class CliAdapter implements BrowserAdapter {
  readonly name = "cli";
  readonly capabilities = TEXTUAL_SURFACE;

  private child: ChildProcessWithoutNullStreams | null = null;
  private lines: string[] = [];
  private affordances: TextAffordance[] = [];
  private command = "";
  private scrollLine = 0;
  private exited = false;
  private readonly windowRows: number;

  constructor(private readonly options: CliAdapterOptions = {}) {
    this.windowRows = options.windowRows ?? DEFAULT_WINDOW_ROWS;
  }

  async open(url: string, _viewport: Viewport): Promise<void> {
    this.command = url.startsWith("cli:") ? url.slice(4) : url;
    await this.run(this.command);
  }

  private run(command: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const [bin, ...args] = command.split(/\s+/);
      this.exited = false;
      this.lines = [];

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(bin, args, { cwd: this.options.cwd, shell: false });
      } catch (error) {
        reject(error);
        return;
      }
      this.child = child;

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const absorb = (chunk: Buffer) => {
        for (const line of stripAnsi(chunk.toString("utf8")).split(/\r?\n/)) {
          this.lines.push(line);
        }
      };
      child.stdout.on("data", absorb);
      child.stderr.on("data", absorb);

      // A missing binary surfaces as an 'error' event, never as 'close'.
      child.on("error", (error) => finish(() => reject(error)));

      child.on("close", (code) => {
        this.exited = true;
        if (code !== 0 && code !== null) {
          this.lines.push(`[process exited with code ${code}]`);
        }
        this.affordances = detectAffordances(this.lines);
        setTimeout(() => finish(resolve), SETTLE_MS);
      });
    });
  }

  async snapshot(): Promise<RawSnapshot> {
    this.affordances = detectAffordances(this.lines);
    const laid = layoutTextFrame({
      lines: this.lines,
      affordances: this.affordances,
      windowRows: this.windowRows,
      scrollLine: this.scrollLine,
    });
    return {
      url: `cli:${this.command}`,
      title: this.command,
      viewport: laid.viewport,
      scrollY: laid.scrollY,
      scrollHeight: laid.scrollHeight,
      elements: laid.elements,
      dialogs: [],
      loadingIndicator: !this.exited,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    return null;
  }

  async moveMouse(_point: Point): Promise<void> {
    // A terminal has no pointer; cursor travel is not perceivable.
  }

  async clickAt(point: Point): Promise<void> {
    const line = Math.floor(point.y / LINE_HEIGHT);
    const target = this.affordances.find((a) => a.line === line);
    if (target?.command) await this.run(target.command);
  }

  async doubleClickAt(point: Point): Promise<void> {
    await this.clickAt(point);
  }

  async typeText(text: string, _perCharIntervalMs: number): Promise<void> {
    this.child?.stdin.write(text);
  }

  async pressKey(key: string): Promise<void> {
    if (key === "Enter") this.child?.stdin.write("\n");
  }

  async scrollBy(deltaY: number): Promise<void> {
    const next = this.scrollLine + Math.round(deltaY / LINE_HEIGHT);
    this.scrollLine = Math.max(0, Math.min(next, Math.max(0, this.lines.length - 1)));
  }

  async goBack(): Promise<void> {
    // Unsupported: capabilities.canGoBack is false.
  }

  async navigate(url: string): Promise<void> {
    await this.open(url, { width: 0, height: 0 });
  }

  async close(): Promise<void> {
    this.child?.kill();
    this.child = null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/cliAdapter.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no output, exit 0.

```bash
git add src/surface/cli.ts tests/cliAdapter.test.ts tests/fixtures
git commit -m "feat: add CLI process adapter for textual surfaces"
```

---

### Task 5: Guard spatial-only checks

**Files:**
- Modify: `src/plugins/plugin.ts` (expose capabilities on `PluginContext`)
- Modify: `src/plugins/accessibility.ts` (gate pixel-dependent checks)
- Test: `tests/spatialGuards.test.ts`

**Interfaces:**
- Consumes: `SurfaceCapabilities`, `VISUAL_SURFACE`, `TEXTUAL_SURFACE` from `src/surface/capabilities.js`; `AccessibilityPlugin` from `src/plugins/accessibility.js`.
- Produces: `PluginContext.capabilities: SurfaceCapabilities`.

- [ ] **Step 1: Locate every PluginContext construction site**

Run: `grep -rn "PluginContext" src/`

Record each file and line where a `PluginContext` object is built. Every one needs a `capabilities` property added in Step 4. Do not guess these locations — the grep output is the authoritative list.

- [ ] **Step 2: Write the failing test**

Create `tests/spatialGuards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AccessibilityPlugin } from "../src/plugins/accessibility.js";
import { TEXTUAL_SURFACE, VISUAL_SURFACE } from "../src/surface/capabilities.js";
import type { SurfaceCapabilities } from "../src/surface/capabilities.js";
import type { Percept } from "../src/core/types.js";

function percept(): Percept {
  return {
    timestamp: 0,
    url: "cli:demo",
    title: "demo",
    viewport: { width: 960, height: 432 },
    scrollY: 0,
    scrollHeight: 100,
    screenshot: null,
    elements: [
      {
        id: 0,
        role: "image",
        text: "",
        box: { x: 0, y: 0, width: 64, height: 64 },
        interactive: false,
        disabled: false,
        editable: false,
        focused: false,
        clippedByViewport: false,
      },
    ],
    dialogs: [],
    loadingIndicator: false,
  };
}

function context(capabilities: SurfaceCapabilities) {
  const findings: unknown[] = [];
  return { findings, ctx: { capabilities, report: (f: unknown) => findings.push(f) } };
}

describe("spatial guards", () => {
  it("reports pixel-dependent findings on a visual surface", async () => {
    const { findings, ctx } = context(VISUAL_SURFACE);
    await new AccessibilityPlugin().onPercept(ctx as never, percept());
    expect(findings.length).toBeGreaterThan(0);
  });

  it("skips pixel-dependent findings on a textual surface", async () => {
    const { findings, ctx } = context(TEXTUAL_SURFACE);
    await new AccessibilityPlugin().onPercept(ctx as never, percept());
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/spatialGuards.test.ts`
Expected: FAIL — the textual case reports a finding, because the guard does not exist yet.

- [ ] **Step 4: Add capabilities to PluginContext**

In `src/plugins/plugin.ts`, add the import:

```ts
import type { SurfaceCapabilities } from "../surface/capabilities.js";
```

and add to the `PluginContext` interface:

```ts
  /** Which perceptual dimensions the current surface actually has. */
  readonly capabilities: SurfaceCapabilities;
```

Then, at every construction site listed in Step 1, populate `capabilities` from the active adapter's `adapter.capabilities`.

- [ ] **Step 5: Gate the pixel-dependent checks**

In `src/plugins/accessibility.ts`, inside `onPercept`, immediately after the existing `screenKey` de-duplication guard (`this.reportedScreens.add(screenKey);`), add:

```ts
    // Pixel geometry and visual styling are meaningless on a textual surface;
    // skip rather than fail, so text surfaces are not scored as failing a
    // visual audit.
    if (!ctx.capabilities.spatial) return;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/spatialGuards.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests pass. Existing accessibility tests still pass because `VISUAL_SURFACE.spatial` is `true`. If an existing test constructs a `PluginContext` literal, add `capabilities: VISUAL_SURFACE` to it.

- [ ] **Step 8: Commit**

```bash
git add src/plugins tests/spatialGuards.test.ts
git commit -m "feat: skip pixel-dependent checks on non-spatial surfaces"
```

---

### Task 6: Live validation against a real command

**Files:**
- Create: `tests/cliSmoke.test.ts`

**Interfaces:**
- Consumes: `CliAdapter` from `src/surface/cli.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the smoke test**

Create `tests/cliSmoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CliAdapter } from "../src/surface/cli.js";

describe("CliAdapter against a real operator command", () => {
  it("perceives node --version as a textual surface", async () => {
    const adapter = new CliAdapter();
    await adapter.open("cli:node --version", { width: 960, height: 432 });
    const snapshot = await adapter.snapshot();
    expect(snapshot.elements.some((el) => /^v\d+\./.test(el.text))).toBe(true);
    expect(snapshot.elements.every((el) => el.fontSize === undefined)).toBe(true);
    await adapter.close();
  });
});
```

`node --version` is used rather than an Axiom script so the suite stays portable and does not require a running proxy.

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/cliSmoke.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Run the full suite and typecheck**

Run: `npm test`
Expected: all pass.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/cliSmoke.test.ts
git commit -m "test: smoke-test CLI adapter against a real command"
```

- [ ] **Step 5: Manual validation against Axiom (not automated)**

This is the spec's motivating use case. With the build produced (`npm run build`) and the Axiom proxy running, confirm a real operator command is perceived with no visual findings:

```bash
node -e "import('./dist/surface/cli.js').then(async ({CliAdapter})=>{const a=new CliAdapter();await a.open('cli:curl -s http://127.0.0.1:3000/metrics',{width:960,height:432});const s=await a.snapshot();console.log(s.elements.slice(0,10).map(e=>e.text));console.log('any fontSize:', s.elements.some(e=>e.fontSize!==undefined));await a.close()})"
```

Expected: the first ten metric lines printed as perceived text, and `any fontSize: false`.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Design 1 — Surface capabilities | Task 1 |
| Design 2 — Text-frame layout | Task 2 |
| Design 3 — CLI adapter contract mapping | Task 4 |
| Design 3 — Affordance detection (3 kinds) | Task 3 |
| Design 4 — Guarding spatial checks | Task 5 |
| Error handling — spawn fails | Task 4, Step 2 (rejection test) |
| Error handling — process exits unexpectedly | Task 4 (`[process exited with code N]`) |
| Error handling — ANSI / control characters | Task 3 (`stripAnsi`) |
| Error handling — process hangs | Task 4 (`loadingIndicator: !this.exited`) |
| Testing — guard regression | Task 5 |
| Testing — non-regression | Task 1 Step 7, Task 5 Step 7 |
| Testing — live validation | Task 6 |

**Known gap:** the spec calls for guarding the vision/multimodal layer as well; Task 5 gates only `accessibility.ts`. The multimodal scanner requires a screenshot and `CliAdapter.screenshot()` returns `null`, so it degrades naturally. If a real run emits a multimodal finding on a textual surface, add the same `capabilities.spatial` guard there.

**Type consistency:** `TextAffordance`, `TextFrame`, and `LaidOutFrame` are defined once in Task 2 and imported unchanged in Tasks 3 and 4. `SurfaceCapabilities` / `VISUAL_SURFACE` / `TEXTUAL_SURFACE` are defined in Task 1 and consumed in Tasks 4 and 5. `layoutTextFrame(frame: TextFrame): LaidOutFrame` and `detectAffordances(lines: readonly string[]): TextAffordance[]` keep identical signatures at every use site.
