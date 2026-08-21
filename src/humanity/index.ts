/**
 * The humanity seam — EVE reads.
 *
 * Every other adapter puts the operator in front of something they drive.
 * This one puts a reader in front of a *digital output*: a report, a deck, an
 * analytics export, a `--help` screen, a stack trace, an API payload — the
 * artifacts software produces that nobody clicks and everybody has to
 * understand. See `docs/humanity-adapter.md`.
 */

export type { HumanityAdapterOptions } from "./adapter.js";
export { HumanityAdapter, humanityAdapterFor } from "./adapter.js";
export type {
  BlockComprehension,
  ComprehensionAnalysis,
  ComprehensionObstacle,
} from "./comprehension.js";
export {
  analyzeComprehension,
  comprehendBlock,
} from "./comprehension.js";
export { ComprehensionPlugin } from "./plugin.js";
export type { ReadingResult, ReadOptions } from "./read.js";
export { readArtifact, readLoadedArtifact, readText } from "./read.js";
export type { AcronymUse, ReadabilityMetrics } from "./readability.js";
export {
  countSyllables,
  findAcronyms,
  findJargon,
  jargonVocabulary,
  measureReadability,
  splitSentences,
} from "./readability.js";
export {
  ArtifactBuilder,
  listReaders,
  parseMetric,
  readArtifactText,
  readDelimited,
  readHtml,
  readJson,
  readMarkdown,
  readText as readPlainText,
  readTranscript,
  readYaml,
  selectReader,
} from "./readers/index.js";
export { renderComprehensionMarkdown } from "./report.js";
export type { LoadArtifactOptions } from "./source.js";
export { artifactFromText, DOC_SCHEME, docTargetOf, loadArtifact } from "./source.js";
export type {
  Artifact,
  ArtifactBlock,
  ArtifactFormat,
  ArtifactGenre,
  ArtifactReader,
  ArtifactSection,
  BlockKind,
  FigureDetail,
  MetricDetail,
  ReaderInput,
  SectionNoun,
  TableDetail,
} from "./types.js";
export { artifactWordCount, sectionNounFor, wordCount } from "./types.js";
export type { HumanityDimension } from "./vocabulary.js";
export {
  HUMANITY_DIMENSIONS,
  registerHumanityVocabulary,
} from "./vocabulary.js";
