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
