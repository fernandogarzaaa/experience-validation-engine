/**
 * The conversation pack's vocabulary registration.
 *
 * Dialogue fails along axes none of the built-in dimensions name. "Usability"
 * does not describe a bot that answered a different question; "navigation"
 * does not describe one that forgot what it was told. So the pack registers
 * its own through the Phase-0 registries rather than by editing core, exactly
 * as the MCP and humanity packs do.
 *
 * All four are `appliesTo: ["conversational"]`: a page is not scored on
 * whether it offered a handoff, and a bot is not scored on tap-target size.
 * Registration is idempotent — the registries are process-global and reject
 * duplicates loudly.
 */

import { findingCategoryRegistry, registerFindingCategory } from "../core/findingCategories.js";
import { actionVerbRegistry, registerActionVerb } from "../protocol/verbs.js";
import { dimensionRegistry, registerDimension } from "../scoring/dimensions.js";
import { CONVERSATION_VERBS } from "../surface/capabilities.js";

const CONVERSATIONAL_ONLY = ["conversational"] as const;

export const CONVERSATION_DIMENSIONS = [
  "conversation.understanding",
  "conversation.grounding",
  "conversation.recovery",
  "conversation.responsiveness",
] as const;

export type ConversationDimension = (typeof CONVERSATION_DIMENSIONS)[number];

const DIMENSION_DESCRIPTIONS: Record<ConversationDimension, string> = {
  "conversation.understanding":
    "Whether the surface understood what was asked — first time, and after the person tried again.",
  "conversation.grounding":
    "Whether it showed it understood and carried the conversation forward: no confident near-misses, no asking twice for the same thing.",
  "conversation.recovery":
    "What happened when it failed — whether it said so, and whether there was a way through to a person.",
  "conversation.responsiveness":
    "Whether replies arrived before silence started reading as being ignored.",
};

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "conversation.understanding": "The surface did not understand what the person asked.",
  "conversation.grounding": "The surface did not show it understood, or lost what it was told.",
  "conversation.recovery": "The conversation failed and offered no way out.",
  "conversation.responsiveness": "The person waited long enough to think it had stopped working.",
};

let registered = false;

/** Register the conversation pack's dimensions, categories and verbs. */
export function registerConversationVocabulary(): void {
  if (registered) return;
  registered = true;

  for (const id of CONVERSATION_DIMENSIONS) {
    if (!dimensionRegistry.has(id)) {
      registerDimension({
        id,
        description: DIMENSION_DESCRIPTIONS[id],
        weight: 0,
        appliesTo: CONVERSATIONAL_ONLY,
      });
    }
  }

  for (const id of CONVERSATION_DIMENSIONS) {
    if (!findingCategoryRegistry.has(id)) {
      registerFindingCategory({
        id,
        description: CATEGORY_DESCRIPTIONS[id] ?? "",
        appliesTo: CONVERSATIONAL_ONLY,
        // Findings here deduct from the like-named dimension through the
        // session scorer's generic registered-dimension rule.
        scoresInto: id,
      });
    }
  }

  for (const verb of CONVERSATION_VERBS) {
    if (!verb.startsWith("chat.") || actionVerbRegistry.has(verb)) continue;
    registerActionVerb({
      id: verb,
      description: VERB_DESCRIPTIONS[verb] ?? "A conversational act.",
      appliesTo: CONVERSATIONAL_ONLY,
    });
  }
}

const VERB_DESCRIPTIONS: Record<string, string> = {
  "chat.say": "Open the conversation, or raise something new.",
  "chat.followup": "Ask about the part the last reply left out.",
  "chat.rephrase": "Say the same thing differently after not being understood.",
  "chat.clarify": "Answer a question the surface asked back.",
  "chat.escalate": "Ask to be put through to a person.",
};
