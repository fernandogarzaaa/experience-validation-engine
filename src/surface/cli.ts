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
        child = spawn(bin!, args, { cwd: this.options.cwd, shell: false });
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
