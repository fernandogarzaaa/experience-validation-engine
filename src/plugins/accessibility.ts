import type { LoopIteration, Percept } from "../core/types.js";
import type { EvePlugin, PluginContext } from "./plugin.js";

/** Minimum tap-target dimension, in CSS px, before a control is hard to hit by finger. */
const MIN_TAP_TARGET_PX = 44;

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

    // Pixel geometry and visual styling are meaningless on a textual surface;
    // skip rather than fail, so text surfaces are not scored as failing a
    // visual audit.
    if (!ctx.capabilities.spatial) return;

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
          .map(
            (el) =>
              `Image at (${Math.round(el.box.x)}, ${Math.round(el.box.y)}), ${Math.round(el.box.width)}×${Math.round(el.box.height)}px`,
          ),
        url: percept.url,
        recommendation:
          "Provide descriptive alt text for meaningful images (empty alt for decorative ones).",
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

    if (ctx.capabilities.pointer === "touch") {
      const smallTargets = percept.elements.filter(
        (el) =>
          el.interactive &&
          !el.disabled &&
          el.box.width > 0 &&
          el.box.height > 0 &&
          (el.box.width < MIN_TAP_TARGET_PX || el.box.height < MIN_TAP_TARGET_PX),
      );
      if (smallTargets.length > 0) {
        ctx.report({
          severity: "major",
          category: "accessibility",
          title: `${smallTargets.length} tap target(s) are smaller than the ${MIN_TAP_TARGET_PX}×${MIN_TAP_TARGET_PX}px minimum`,
          description:
            "Interactive controls below the widely-used 44×44 CSS px minimum tap-target size are hard to hit accurately with a finger, especially for users with reduced motor precision.",
          evidence: smallTargets
            .slice(0, 3)
            .map(
              (el) =>
                `${el.role} "${el.text.slice(0, 30)}" is ${Math.round(el.box.width)}×${Math.round(el.box.height)}px`,
            ),
          url: percept.url,
          recommendation: "Enlarge tap targets to at least 44×44 CSS px, including padding.",
        });
      }

      // `occludedByKeyboard` is set by the observation layer, not perceived
      // directly — see Percept.keyboardOcclusion.
      const occluded = percept.elements.filter(
        (el) => el.occludedByKeyboard && (el.interactive || el.text.trim()),
      );
      if (occluded.length > 0) {
        ctx.report({
          severity: "major",
          category: "accessibility",
          title: `${occluded.length} element(s) are covered by the on-screen keyboard`,
          description:
            "While a text field holds focus, the soft keyboard covers the bottom of the screen. Content placed there — often a submit button or a validation message — is invisible until the keyboard is dismissed.",
          evidence: occluded
            .slice(0, 3)
            .map((el) => `${el.role} "${el.text.slice(0, 30)}" at y=${Math.round(el.box.y)}`),
          url: percept.url,
          recommendation:
            "Keep primary actions and validation messages above the keyboard's typical coverage, or scroll them into view on focus.",
        });
      }
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
          evidence: [
            `${interactive.length} interactive elements present, none focused/focusable-visible.`,
          ],
          url: percept.url,
          recommendation:
            "Ensure a visible focus indicator and a sane tab order for every interactive element.",
        });
      }
    }
  }

  /**
   * A hover-only affordance can't be detected from a single percept — there
   * is nothing in the DOM/CSS boundary a `Percept` is allowed to expose that
   * says "this only appears on hover" (that would be exactly the privileged
   * information adapters are forbidden from leaking). What *is* observable,
   * perceptually, is the operator's own behavior: cognition decided to hover
   * over something. On a surface with no persistent pointer, that decision
   * itself is the evidence — the affordance the operator's mental model
   * expected to reach is unreachable here.
   */
  async onSessionEnd(ctx: PluginContext, iterations: readonly LoopIteration[]): Promise<void> {
    if (ctx.capabilities.canHover) return;
    const reported = new Set<string>();
    for (const it of iterations) {
      if (it.action.kind !== "hover") continue;
      const target = it.action.target;
      const key = `${it.url}#${target.role}#${target.text}`;
      if (reported.has(key)) continue;
      reported.add(key);
      ctx.report({
        severity: "major",
        category: "accessibility",
        title: `Hover-only affordance is unreachable on this surface: "${target.text.slice(0, 40) || target.role}"`,
        description:
          "The operator expected hovering to reveal or activate this control, but this surface has no persistent pointer — hover-gated content is invisible to a touch user, not merely awkward to reach.",
        evidence: [
          `Attempted hover over ${target.role} at (${Math.round(target.box.x)}, ${Math.round(target.box.y)}) on ${it.url}`,
        ],
        url: it.url,
        recommendation:
          "Expose this affordance through a tap-visible control (icon, always-visible label, or tap-to-reveal) instead of relying on :hover.",
      });
    }
  }
}
