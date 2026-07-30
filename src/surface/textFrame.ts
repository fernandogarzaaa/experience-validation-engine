import type { PerceivedRole, Viewport, VisibleElement } from "../core/types.js";

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

  const lastVisibleLine = frame.scrollLine + frame.windowRows;
  const affordancesByLine = new Map<number, TextAffordance[]>();
  for (const affordance of frame.affordances) {
    const onLine = affordancesByLine.get(affordance.line) ?? [];
    onLine.push(affordance);
    affordancesByLine.set(affordance.line, onLine);
  }

  const pushText = (line: number, column: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    elements.push({
      id: id++,
      role: "text",
      text: trimmed,
      box: {
        x: column * CELL_WIDTH,
        y: (line - frame.scrollLine) * LINE_HEIGHT,
        width: trimmed.length * CELL_WIDTH,
        height: LINE_HEIGHT,
      },
      interactive: false,
      disabled: false,
      editable: false,
      focused: false,
      clippedByViewport: line < frame.scrollLine || line >= lastVisibleLine,
    });
  };

  frame.lines.forEach((line, index) => {
    if (!line.trim()) return;
    const onLine = (affordancesByLine.get(index) ?? []).slice().sort((a, b) => a.column - b.column);
    if (onLine.length === 0) {
      pushText(index, 0, line);
      return;
    }
    // Render text around each affordance rather than dropping the whole
    // line — an affordance is part of a sentence, not the entire sentence.
    let cursor = 0;
    for (const affordance of onLine) {
      pushText(index, cursor, line.slice(cursor, affordance.column));
      elements.push({
        id: id++,
        role: affordance.role,
        text: affordance.text,
        box: {
          x: affordance.column * CELL_WIDTH,
          y: (affordance.line - frame.scrollLine) * LINE_HEIGHT,
          width: affordance.text.length * CELL_WIDTH,
          height: LINE_HEIGHT,
        },
        interactive: true,
        disabled: false,
        editable: affordance.role === "textbox",
        focused: false,
        clippedByViewport: affordance.line < frame.scrollLine || affordance.line >= lastVisibleLine,
      });
      cursor = affordance.column + affordance.text.length;
    }
    pushText(index, cursor, line.slice(cursor));
  });

  return {
    elements,
    viewport: { width: MAX_COLUMNS * CELL_WIDTH, height: frame.windowRows * LINE_HEIGHT },
    scrollY: frame.scrollLine * LINE_HEIGHT,
    scrollHeight: frame.lines.length * LINE_HEIGHT,
  };
}
