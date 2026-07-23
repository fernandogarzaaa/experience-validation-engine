import type { Percept } from "../core/types.js";
import type { EvePlugin, PluginContext } from "./plugin.js";
import { cultureOf } from "../personas/culture.js";
import type { CultureProfile } from "../personas/culture.js";

/**
 * Localization plugin.
 *
 * Uses the operator's cultural profile to flag convention mismatches a user
 * from that locale would perceive as friction: wrong currency symbol,
 * unexpected date format, decimal-separator mismatch, and (for RTL locales)
 * a left-to-right layout. Convention mismatch increases cognitive load and
 * lowers trust (Marcus & Gould 2000). Purely perceptual — reads only visible
 * text and the operator's own cultural expectations.
 */
export class LocalizationPlugin implements EvePlugin {
  readonly name = "localization";
  private culture: CultureProfile | null = null;
  private readonly reportedScreens = new Set<string>();
  private rtlReported = false;

  async onSessionStart(ctx: PluginContext): Promise<void> {
    this.culture = cultureOf(ctx.persona);
  }

  async onPercept(ctx: PluginContext, percept: Percept): Promise<void> {
    if (!this.culture) this.culture = cultureOf(ctx.persona);
    const culture = this.culture;
    if (culture.locale === "en-US" && ctx.persona.name && !hasExplicitCulture(ctx)) {
      // Default locale with no explicit cultural intent — skip to avoid noise.
      return;
    }
    if (this.reportedScreens.has(percept.url)) return;
    this.reportedScreens.add(percept.url);

    const text = percept.elements.map((e) => e.text).join("  ");

    // Currency mismatch.
    const currencies = ["$", "£", "€", "¥", "₪", "﷼"];
    const foreign = currencies.filter((c) => c !== culture.currency && text.includes(c));
    if (foreign.length > 0 && /\d/.test(text)) {
      ctx.report({
        severity: "minor",
        category: "content",
        title: `Currency shown in ${foreign.join("/")}, but this user expects ${culture.currency}`,
        description: `A ${culture.name} user reads prices in ${culture.currency}; seeing ${foreign.join("/")} forces mental conversion and lowers trust in pricing.`,
        evidence: [`Locale: ${culture.locale}`],
        url: percept.url,
        recommendation: "Localize currency to the user's locale, or make the currency explicit and switchable.",
      });
    }

    // Date format mismatch: ambiguous numeric dates.
    const dateMatch = text.match(/\b(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})\b/);
    if (dateMatch) {
      const perceivedFormat = guessDateFormat(dateMatch);
      if (perceivedFormat && perceivedFormat !== culture.dateFormat) {
        ctx.report({
          severity: "minor",
          category: "content",
          title: `Date "${dateMatch[0]}" appears in ${perceivedFormat}, not this user's ${culture.dateFormat}`,
          description: `A ${culture.name} user reads dates as ${culture.dateFormat}; the displayed order risks being misread (e.g. day vs month).`,
          evidence: [`Locale: ${culture.locale}`],
          url: percept.url,
          recommendation: "Format dates per locale, or use an unambiguous format (e.g. 2026 Jul 21).",
        });
      }
    }

    // RTL layout mismatch (report once).
    if (culture.readingDirection === "rtl" && !this.rtlReported) {
      const leftAnchored = percept.elements.filter(
        (e) => e.interactive && e.box.x < percept.viewport.width * 0.15,
      ).length;
      const rightAnchored = percept.elements.filter(
        (e) => e.interactive && e.box.x > percept.viewport.width * 0.6,
      ).length;
      if (leftAnchored > rightAnchored + 2) {
        this.rtlReported = true;
        ctx.report({
          severity: "major",
          category: "accessibility",
          title: "Layout is left-to-right for a right-to-left reader",
          description: `A ${culture.name} user scans from the right; a left-anchored layout inverts their natural reading path and controls land where they don't look first.`,
          evidence: [`Locale: ${culture.locale}`, `${leftAnchored} left-anchored vs ${rightAnchored} right-anchored controls`],
          url: percept.url,
          recommendation: "Mirror the layout (dir=\"rtl\") so primary content and navigation start from the right.",
        });
      }
    }
  }
}

function hasExplicitCulture(ctx: PluginContext): boolean {
  // The persona carries a non-default culture only if one was attached.
  return cultureOf(ctx.persona).locale !== "en-US";
}

function guessDateFormat(m: RegExpMatchArray): "MDY" | "DMY" | "YMD" | null {
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  if (m[1]!.length === 4) return "YMD";
  if (m[3]!.length === 4) {
    if (a > 12) return "DMY";
    if (b > 12) return "MDY";
    return null; // ambiguous
  }
  void c;
  return null;
}
