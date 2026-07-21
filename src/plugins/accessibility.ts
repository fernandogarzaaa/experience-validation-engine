import type { Percept } from "../core/types.js";
import type { EvePlugin, PluginContext } from "./plugin.js";

/**
 * Accessibility plugin: perceptual accessibility review beyond what the
 * operator's own vision checks catch.
 *
 * All checks operate on the percept (visible reality), not on ARIA metadata
 * dumps — an unlabeled image is flagged because a screen-reader user would
 * perceive nothing, mirroring how the barrier manifests.
 */
export class AccessibilityPlugin implements EvePlugin {
  readonly name = "accessibility";
  private readonly reportedScreens = new Set<string>();

  async onPercept(ctx: PluginContext, percept: Percept): Promise<void> {
    const screenKey = `${percept.url}#${percept.scrollY}`;
    if (this.reportedScreens.has(screenKey)) return;
    this.reportedScreens.add(screenKey);

    // Images with no textual alternative.
    const unlabeledImages = percept.elements.filter(
      (el) => el.role === "image" && !el.text.trim() && el.box.width > 32 && el.box.height > 32,
    );
    if (unlabeledImages.length > 0) {
      ctx.report({
        severity: "minor",
        category: "accessibility",
        title: `${unlabeledImages.length} significant image(s) carry no textual alternative`,
        description:
          "Meaningful images without alt text are invisible to screen-reader users and convey nothing when they fail to load.",
        evidence: unlabeledImages
          .slice(0, 3)
          .map((el) => `Image at (${Math.round(el.box.x)}, ${Math.round(el.box.y)}), ${Math.round(el.box.width)}×${Math.round(el.box.height)}px`),
        url: percept.url,
        recommendation: "Provide descriptive alt text for meaningful images (empty alt for decorative ones).",
      });
    }

    // Unlabeled interactive controls.
    const unlabeledControls = percept.elements.filter(
      (el) =>
        el.interactive &&
        !el.disabled &&
        !el.text.trim() &&
        (el.role === "button" || el.role === "checkbox" || el.role === "textbox") &&
        el.box.width > 12 &&
        el.box.height > 12,
    );
    if (unlabeledControls.length > 0) {
      ctx.report({
        severity: "major",
        category: "accessibility",
        title: `${unlabeledControls.length} interactive control(s) have no perceivable label`,
        description:
          "Controls without visible or accessible labels cannot be understood by assistive technology, and sighted users must guess their purpose from position alone.",
        evidence: unlabeledControls
          .slice(0, 3)
          .map((el) => `${el.role} at (${Math.round(el.box.x)}, ${Math.round(el.box.y)})`),
        url: percept.url,
        recommendation: "Give every interactive control a visible label or accessible name.",
      });
    }

    // Keyboard operability: for keyboard-only personas, a screen where no
    // element ever shows focus is a hard barrier.
    if (ctx.persona.accessibility.keyboardOnly) {
      const anyFocus = percept.elements.some((el) => el.focused);
      const interactive = percept.elements.filter((el) => el.interactive && !el.disabled);
      if (!anyFocus && interactive.length > 3) {
        ctx.report({
          severity: "major",
          category: "accessibility",
          title: "No visible keyboard focus anywhere on the screen",
          description:
            "A keyboard-only user cannot tell where they are: no element on this screen shows focus, so Tab navigation is blind.",
          evidence: [`${interactive.length} interactive elements present, none focused/focusable-visible.`],
          url: percept.url,
          recommendation: "Ensure a visible focus indicator and a sane tab order for every interactive element.",
        });
      }
    }
  }
}
