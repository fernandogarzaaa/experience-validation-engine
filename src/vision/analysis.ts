import type { Percept, VisibleElement } from "../core/types.js";
import type { AccessibilityProfile } from "../personas/persona.js";
import {
  type DecodedImage,
  contrastRatio,
  decodePng,
  frameDiffRatio,
  luminanceVariance,
  parseHexColor,
  relativeLuminance,
  sampleLuminances,
} from "./pixels.js";

/**
 * Visual analysis over percepts: layout geometry checks (from element boxes)
 * plus pixel-level checks (from screenshots when available). Each check
 * returns structured issues that the engine converts into findings.
 */

export type VisualIssueKind =
  | "low-contrast"
  | "tiny-text"
  | "tiny-target"
  | "overlapping-elements"
  | "clipped-element"
  | "horizontal-overflow"
  | "misalignment"
  | "blank-screen"
  | "visual-regression"
  | "color-only-signal";

export interface VisualIssue {
  readonly kind: VisualIssueKind;
  readonly detail: string;
  readonly severityHint: "critical" | "major" | "minor";
  readonly elementText?: string;
}

/* ------------------------------------------------------------------ */
/* Geometry checks (no pixels needed)                                 */
/* ------------------------------------------------------------------ */

export function checkGeometry(
  percept: Percept,
  accessibility: AccessibilityProfile,
): VisualIssue[] {
  const issues: VisualIssue[] = [];
  const { viewport } = percept;

  const meaningful = percept.elements.filter((el) => el.box.width > 0 && el.box.height > 0);

  // Horizontal overflow / viewport clipping.
  for (const el of meaningful) {
    if (el.clippedByViewport && el.text.trim() && el.box.y >= 0 && el.box.y < viewport.height) {
      issues.push({
        kind: "clipped-element",
        detail: `"${trim(el.text)}" extends beyond the viewport edge and is partially unreadable.`,
        severityHint: "major",
        elementText: el.text,
      });
    }
  }
  const overflowing = meaningful.filter(
    (el) => el.box.x + el.box.width > viewport.width + 8 && el.box.x < viewport.width,
  );
  if (overflowing.length >= 3) {
    issues.push({
      kind: "horizontal-overflow",
      detail: `${overflowing.length} elements overflow the viewport horizontally — the page likely requires sideways scrolling.`,
      severityHint: "major",
    });
  }

  // Tiny text.
  for (const el of meaningful) {
    if (
      el.text.trim().length > 3 &&
      el.fontSize !== undefined &&
      el.fontSize < accessibility.minComfortableFontPx - 1
    ) {
      issues.push({
        kind: "tiny-text",
        detail: `"${trim(el.text)}" is rendered at ${el.fontSize}px — below this user's comfortable minimum of ${accessibility.minComfortableFontPx}px.`,
        severityHint: el.fontSize < 10 ? "major" : "minor",
        elementText: el.text,
      });
    }
  }

  // Tiny interactive targets (WCAG 2.5.8 target size ≥ 24px).
  for (const el of meaningful) {
    if (
      el.interactive &&
      !el.disabled &&
      el.text.trim() &&
      (el.box.width < 24 || el.box.height < 24) &&
      el.role !== "link" // inline links are conventionally small
    ) {
      issues.push({
        kind: "tiny-target",
        detail: `Interactive "${trim(el.text)}" is only ${Math.round(el.box.width)}×${Math.round(el.box.height)}px — hard to hit, especially with motor impairments.`,
        severityHint: "minor",
        elementText: el.text,
      });
    }
  }

  // Overlapping interactive elements (misrendered layout).
  const interactive = meaningful.filter((el) => el.interactive && !el.disabled && el.text.trim());
  for (let i = 0; i < interactive.length && i < 60; i++) {
    for (let j = i + 1; j < interactive.length && j < 60; j++) {
      const a = interactive[i]!;
      const b = interactive[j]!;
      const overlap = overlapArea(a, b);
      const minArea = Math.min(area(a), area(b));
      if (minArea > 0 && overlap / minArea > 0.5 && a.text.trim() !== b.text.trim()) {
        issues.push({
          kind: "overlapping-elements",
          detail: `"${trim(a.text)}" and "${trim(b.text)}" overlap by ${Math.round((overlap / minArea) * 100)}% — one is likely covering the other.`,
          severityHint: "major",
        });
      }
    }
  }

  // Misalignment: controls that almost share a left edge (sloppy layout).
  const xs = interactive
    .filter((el) => el.role === "button" || el.role === "textbox")
    .map((el) => el.box.x);
  const clusters = clusterValues(xs, 12);
  for (const cluster of clusters) {
    const spread = Math.max(...cluster) - Math.min(...cluster);
    if (cluster.length >= 3 && spread > 2 && spread <= 12) {
      issues.push({
        kind: "misalignment",
        detail: `${cluster.length} controls are almost but not exactly left-aligned (within ${Math.round(spread)}px) — reads as visual sloppiness.`,
        severityHint: "minor",
      });
      break; // one misalignment finding per screen is enough
    }
  }

  // Contrast from declared colors (works without screenshots).
  issues.push(...checkDeclaredContrast(percept, accessibility));

  return issues;
}

function checkDeclaredContrast(
  percept: Percept,
  accessibility: AccessibilityProfile,
): VisualIssue[] {
  const issues: VisualIssue[] = [];
  for (const el of percept.elements) {
    if (!el.text.trim() || el.text.trim().length < 3) continue;
    if (!el.color || !el.backgroundColor) continue;
    let fg = parseHexColor(el.color);
    let bg = parseHexColor(el.backgroundColor);
    if (!fg || !bg) continue;
    if (accessibility.colorVision !== "typical") {
      fg = simulateColorVision(fg, accessibility.colorVision);
      bg = simulateColorVision(bg, accessibility.colorVision);
    }
    const ratio = contrastRatio(
      relativeLuminance(fg[0], fg[1], fg[2]),
      relativeLuminance(bg[0], bg[1], bg[2]),
    );
    const isLargeText = (el.fontSize ?? 14) >= 18.5;
    const minimum = isLargeText ? 3 : 4.5;
    if (ratio < minimum) {
      issues.push({
        kind: "low-contrast",
        detail: `"${trim(el.text)}" has a contrast ratio of ${ratio.toFixed(2)}:1 (${el.color} on ${el.backgroundColor}) — below the WCAG AA minimum of ${minimum}:1${accessibility.colorVision !== "typical" ? ` as perceived with ${accessibility.colorVision}` : ""}.`,
        severityHint: ratio < 2.5 ? "major" : "minor",
        elementText: el.text,
      });
    }
  }
  return issues.slice(0, 8);
}

/**
 * Approximate dichromatic color perception (Viénot/Brettel-style linear
 * projection, simplified to sRGB space). Good enough to flag red/green
 * signals that collapse for the simulated viewer.
 */
export function simulateColorVision(
  [r, g, b]: [number, number, number],
  kind: AccessibilityProfile["colorVision"],
): [number, number, number] {
  switch (kind) {
    case "protanopia":
      return [
        clampByte(0.567 * r + 0.433 * g),
        clampByte(0.558 * r + 0.442 * g),
        clampByte(0.242 * g + 0.758 * b),
      ];
    case "deuteranopia":
      return [
        clampByte(0.625 * r + 0.375 * g),
        clampByte(0.7 * r + 0.3 * g),
        clampByte(0.3 * g + 0.7 * b),
      ];
    case "tritanopia":
      return [
        clampByte(0.95 * r + 0.05 * g),
        clampByte(0.433 * g + 0.567 * b),
        clampByte(0.475 * g + 0.525 * b),
      ];
    default:
      return [r, g, b];
  }
}

/* ------------------------------------------------------------------ */
/* Pixel checks (screenshot required)                                 */
/* ------------------------------------------------------------------ */

export function checkPixels(percept: Percept): VisualIssue[] {
  if (!percept.screenshot) return [];
  const issues: VisualIssue[] = [];
  let img: DecodedImage;
  try {
    img = decodePng(percept.screenshot);
  } catch {
    return [];
  }

  // Blank screen: almost no luminance variation but the page claims content.
  if (percept.elements.length > 3 && luminanceVariance(img) < 0.0004) {
    issues.push({
      kind: "blank-screen",
      detail:
        "The rendered screen is visually blank/uniform even though content should be present.",
      severityHint: "critical",
    });
  }

  // Pixel-sampled contrast for text elements without declared colors.
  for (const el of percept.elements) {
    if (!el.text.trim() || el.text.trim().length < 4) continue;
    if (el.color && el.backgroundColor) continue; // declared-color path covers it
    if (el.box.width < 8 || el.box.height < 8) continue;
    if (el.box.y < 0 || el.box.y > percept.viewport.height) continue;
    const lums = sampleLuminances(img, el.box);
    if (lums.length < 16) continue;
    // Estimate fg/bg as the 5th/95th percentile luminances inside the box.
    const lo = lums[Math.floor(lums.length * 0.05)]!;
    const hi = lums[Math.floor(lums.length * 0.95)]!;
    const ratio = contrastRatio(hi, lo);
    if (ratio < 2.2) {
      issues.push({
        kind: "low-contrast",
        detail: `Text region "${trim(el.text)}" shows very little luminance variation on screen (est. ${ratio.toFixed(2)}:1) — likely unreadable.`,
        severityHint: "minor",
        elementText: el.text,
      });
      if (issues.length > 12) break;
    }
  }
  return issues;
}

/**
 * Visual regression between two visits to the same screen: large unexpected
 * pixel churn while the perceived text stayed the same.
 */
export function checkRegression(
  previousShot: Buffer,
  currentShot: Buffer,
  sameTextContent: boolean,
): VisualIssue | null {
  try {
    const a = decodePng(previousShot);
    const b = decodePng(currentShot);
    const diff = frameDiffRatio(a, b);
    if (sameTextContent && diff > 0.35) {
      return {
        kind: "visual-regression",
        detail: `Revisiting the same screen rendered ${(diff * 100).toFixed(0)}% of pixels differently while showing the same content — layout instability or a visual regression.`,
        severityHint: "major",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */

function area(el: VisibleElement): number {
  return el.box.width * el.box.height;
}

function overlapArea(a: VisibleElement, b: VisibleElement): number {
  const x = Math.max(
    0,
    Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x),
  );
  const y = Math.max(
    0,
    Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y),
  );
  return x * y;
}

function clusterValues(values: number[], tolerance: number): number[][] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  let current: number[] = [];
  for (const v of sorted) {
    if (current.length === 0 || v - current[0]! <= tolerance) current.push(v);
    else {
      clusters.push(current);
      current = [v];
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function trim(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
}
