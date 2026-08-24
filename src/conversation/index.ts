/**
 * The dialogue seam — EVE has a conversation.
 *
 * The browser adapters put the operator in front of software they drive; the
 * humanity seam put a reader in front of output they receive. This is the
 * third relationship: a surface that **answers back** — a support bot, an
 * LLM copilot, a voice assistant, the "ask me anything" box that has quietly
 * become the front door of a lot of products.
 *
 * See `docs/conversational-adapter.md`.
 */

export type { ConversationAdapterOptions } from "./adapter.js";
export { ConversationAdapter } from "./adapter.js";
export type { AnalyzeConversationInput, ConversationAnalysis } from "./analysis.js";
export { analyzeConversation } from "./analysis.js";
export type { HttpBackendOptions } from "./backends/http.js";
export { extractReply, HttpBackend } from "./backends/http.js";
export type { Script, ScriptRule } from "./backends/scripted.js";
export { DEMO_SUPPORT_BOT, ScriptedBackend } from "./backends/scripted.js";
export type { ConversationResult, ConverseOptions } from "./converse.js";
export { converse } from "./converse.js";
export type { ConversationPluginOptions } from "./plugin.js";
export { ConversationPlugin } from "./plugin.js";
export { renderConversationMarkdown } from "./report.js";
export type {
  ClassifiedTurn,
  ConversationAffordance,
  ConversationBackend,
  ConversationKind,
  ConversationReply,
  ConversationTurn,
  Speaker,
} from "./types.js";
export { detectNonAnswer, offersHandoff, turnWordCount } from "./types.js";
export type { ConversationDimension } from "./vocabulary.js";
export {
  CONVERSATION_DIMENSIONS,
  registerConversationVocabulary,
} from "./vocabulary.js";
