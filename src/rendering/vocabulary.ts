/**
 * The rendering check's vocabulary registration.
 *
 * A disagreement between the DOM and the rendering is not any of the existing
 * categories. "Accessibility" is close for two of the three, but it names a
 * different thing: an accessibility finding says a person with a particular
 * need is excluded, whereas `unaccounted-content` says nothing that reads the
 * page — assistive technology, EVE itself, any DOM-based tool — can reach
 * content everyone else can see. And `phantom-control` is not an
 * accessibility problem at all: it is a control that exists for automation
 * and for nobody else.
 *
 * So it registers its own category through the Phase-0 registries,
 * as the MCP, humanity and conversation packs do, rather than filing these
 * under a heading that would misdescribe them.
 *
 * `appliesTo: ["visual"]` throughout. There is no rendering to compare a DOM
 * against on a textual, document or conversational surface, so these can
 * never fire there and must not appear as dimensions those surfaces failed.
 */

import { findingCategoryRegistry, registerFindingCategory } from "../core/findingCategories.js";
import { dimensionRegistry, registerDimension } from "../scoring/dimensions.js";

const VISUAL_ONLY = ["visual"] as const;

/** The dimension these findings deduct from. */
export const RENDERING_DIMENSION = "rendering.fidelity";

export const RENDERING_CATEGORY = "rendering.fidelity";

let registered = false;

/** Register the rendering check's dimension and finding category. Idempotent. */
export function registerRenderingVocabulary(): void {
  if (registered) return;
  registered = true;

  if (!dimensionRegistry.has(RENDERING_DIMENSION)) {
    registerDimension({
      id: RENDERING_DIMENSION,
      description:
        "Whether the page renders what it claims: no controls that exist only in the markup, no text that never reached the screen, and nothing on screen that only a pair of eyes can reach.",
      // Weight 0, like every other pack dimension: the check reports what it
      // sees and lets the report say so, rather than silently moving a score
      // that predates it.
      weight: 0,
      appliesTo: VISUAL_ONLY,
    });
  }

  if (!findingCategoryRegistry.has(RENDERING_CATEGORY)) {
    registerFindingCategory({
      id: RENDERING_CATEGORY,
      description: "What is drawn on screen and what the page says about itself disagree.",
      appliesTo: VISUAL_ONLY,
      // evidenceRequired is forced to true by the registrar — not a choice
      // this pack gets to make, which is the point of it living there.
      scoresInto: RENDERING_DIMENSION,
    });
  }
}
