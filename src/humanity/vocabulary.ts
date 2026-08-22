/**
 * The humanity pack's vocabulary registration.
 *
 * Reading fails along axes the sixteen built-in dimensions do not name.
 * "Usability" does not describe a paragraph nobody can parse; "navigation"
 * does not describe a deck whose slide titles assert nothing. So the pack
 * registers its own — `humanity.comprehension`, `humanity.readability`,
 * `humanity.structure` — through the Phase-0 registries rather than by
 * editing core, exactly as the MCP pack does.
 *
 * All three are `appliesTo: ["document"]`: a live page is not scored for
 * whether its prose has a baseline for every number, and a document is not
 * scored for tap-target size. Registration is idempotent, because the
 * registries are process-global and reject duplicates loudly.
 */

import { findingCategoryRegistry, registerFindingCategory } from "../core/findingCategories.js";
import { actionVerbRegistry, registerActionVerb } from "../protocol/verbs.js";
import { dimensionRegistry, registerDimension } from "../scoring/dimensions.js";
import { DOCUMENT_VERBS } from "../surface/capabilities.js";

const DOCUMENT_ONLY = ["document"] as const;

/** The dimensions a reading session is scored on. */
export const HUMANITY_DIMENSIONS = [
  "humanity.comprehension",
  "humanity.readability",
  "humanity.structure",
] as const;

export type HumanityDimension = (typeof HUMANITY_DIMENSIONS)[number];

const DIMENSION_DESCRIPTIONS: Record<HumanityDimension, string> = {
  "humanity.comprehension":
    "Whether the reader actually understood it: terms defined before use, figures that assert something, numbers with a baseline, an ending that says what to do.",
  "humanity.readability":
    "The cost of parsing the prose itself — sentence length, syllable weight, and the register the writing assumes.",
  "humanity.structure":
    "Whether the artifact can be scanned, re-entered and navigated: headings, paragraph size, slide density, nesting depth.",
};

/**
 * Finding categories, each linked to the dimension it deducts from. The
 * session scorer's generic registered-dimension rule does the arithmetic,
 * so a reading session with no comprehension findings simply does not
 * report the dimension rather than inventing a perfect score for it.
 */
const CATEGORY_TO_DIMENSION: Record<string, HumanityDimension> = {
  "humanity.comprehension": "humanity.comprehension",
  "humanity.readability": "humanity.readability",
  "humanity.structure": "humanity.structure",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "humanity.comprehension": "Something the reader read but did not understand.",
  "humanity.readability": "Prose that costs more to parse than its content warrants.",
  "humanity.structure": "Content the reader cannot scan, navigate or re-enter.",
};

let registered = false;

/** Register the humanity pack's dimensions, categories and reading verbs. */
export function registerHumanityVocabulary(): void {
  if (registered) return;
  registered = true;

  for (const id of HUMANITY_DIMENSIONS) {
    if (!dimensionRegistry.has(id)) {
      registerDimension({
        id,
        description: DIMENSION_DESCRIPTIONS[id],
        weight: 0,
        appliesTo: DOCUMENT_ONLY,
      });
    }
  }

  for (const [id, dimension] of Object.entries(CATEGORY_TO_DIMENSION)) {
    if (!findingCategoryRegistry.has(id)) {
      registerFindingCategory({
        id,
        description: CATEGORY_DESCRIPTIONS[id] ?? "",
        appliesTo: DOCUMENT_ONLY,
        scoresInto: dimension,
      });
    }
  }

  for (const verb of DOCUMENT_VERBS) {
    // `read` and `wait` are canonical CP/1 verbs already; only the reading
    // verbs proper are the pack's to register.
    if (!verb.startsWith("doc.") || actionVerbRegistry.has(verb)) continue;
    registerActionVerb({
      id: verb,
      description: VERB_DESCRIPTIONS[verb] ?? "A reading act on a document surface.",
      appliesTo: DOCUMENT_ONLY,
    });
  }
}

const VERB_DESCRIPTIONS: Record<string, string> = {
  "doc.skim": "Move the eye over a section fast, taking headings and shape but not detail.",
  "doc.read": "Read the current section closely, at this persona's reading speed.",
  "doc.study": "Stop on one table, figure or metric and work out what it is claiming.",
  "doc.next": "Turn to the next section, slide or page.",
  "doc.back": "Turn back to the previous section.",
  "doc.reread": "Read the current section again after failing to follow it.",
  "doc.follow": "Follow a link or cross-reference to where it points.",
};
