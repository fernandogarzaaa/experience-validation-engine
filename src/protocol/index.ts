/**
 * CP/1 — the Cognitive Protocol, version 1.
 *
 * EVE, AXIOM-AETHER and ADAM are one organism. CP/1 is the stable wire contract
 * between them: twelve canonical types each with exactly one owning repository,
 * a closed set of fourteen events, mandatory chained provenance, and a
 * canonical byte encoding with no floating point on the wire.
 *
 * The normative source lives in AXIOM-AETHER at `protocol/cp1/`. This
 * repository **vendors** a copy under its own `protocol/cp1/` and implements a
 * hand-written binding here. There is no build-time dependency between the
 * repositories in any direction — which is what makes the arrangement
 * survivable across three languages and three release cadences. Drift is caught
 * by `conformance.ts` running against the vendored corpus and manifest, not by
 * a linker.
 *
 * EVE owns `Observation`, `Experience` and `FitnessResult`. It reads `Mutation`
 * and `ValidationRequest`. It may not author anything else, which is why
 * {@link documents} is the only place these are minted and why every one of
 * them carries `authored_by: "eve"`.
 *
 * @example Measuring a mutation
 * ```ts
 * import { validateMutation } from "eve/fitness";
 *
 * const result = await validateMutation(request);
 * console.log(result.recommendation, result.delta_bp);
 * ```
 */

export {
  CanonicalError,
  type CanonicalValue,
  contentHash,
  fromBasisPoints,
  isTimestamp,
  seal,
  sha256Hex,
  timestamp,
  toBasisPoints,
  toCanonical,
  toSignedBasisPoints,
  verifySeal,
} from "./canonical.js";
export {
  type ConformanceFailure,
  checkCorpus,
  checkManifest,
  describeFailures,
  isEventKind,
} from "./conformance.js";
export { event, experienceFrom, observationFrom, provenance } from "./documents.js";
export {
  ENVELOPE_SCHEMA,
  EnvelopeError,
  type EnvelopeFailure,
  fromLine,
  openEnvelope,
  type SignedEnvelope,
  sealEnvelope,
  toLine,
} from "./envelope.js";
export {
  type Component,
  type CpEvent,
  EVENT_EMITTER,
  EVENT_KINDS,
  type EventKind,
  type Experience,
  type ExperienceAction,
  type ExperienceOutcome,
  type FitnessResult,
  type Measurement,
  type Mutation,
  type MutationKind,
  type MutationStatus,
  type Observation,
  type PayloadValue,
  type PerceivedAffordance,
  type Provenance,
  type Recommendation,
  SUBJECT_TYPES,
  type SubjectType,
  type Surface,
  type ValidationRequest,
} from "./types.js";

/** The revision of the normative source this binding implements. */
export const CP1_VERSION = "1.0.0";

/** The protocol identifier carried by every CP/1 document. */
export const CP = "cp1" as const;
