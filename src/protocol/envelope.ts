/**
 * CP/1 transport: the signed envelope and the line-delimited JSON protocol.
 *
 * The envelope carries its payload as a **string**, not a nested object, so the
 * bytes that were hashed are exactly the bytes transmitted. Nesting the
 * document would let the receiver's JSON writer re-render it — different key
 * order, different escaping — and invalidate a hash that was correct when it
 * was computed.
 *
 * See `protocol/cp1/SPEC.md` section 6.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { CanonicalError, seal, sha256Hex, toCanonical, verifySeal } from "./canonical.js";

export const ENVELOPE_SCHEMA = "cp1_signed_envelope";

export interface SignedEnvelope {
  readonly cp: "cp1";
  readonly schema: typeof ENVELOPE_SCHEMA;
  /** Canonical-form JSON of the document, as a string. */
  readonly payload: string;
  readonly sha256: string;
  /**
   * HMAC-SHA256 over `sha256`, keyed by the fleet secret. Optional: over a
   * stdio subprocess boundary the parent already controls the child, so
   * requiring a shared secret there would be ceremony without a threat.
   */
  readonly hmac?: string;
}

export type EnvelopeFailure =
  | "bad-schema"
  | "hash-mismatch"
  | "signature-missing"
  | "signature-invalid"
  | "no-key-to-verify"
  | "malformed-payload"
  | "not-canonical"
  | "seal-broken";

export class EnvelopeError extends Error {
  constructor(readonly failure: EnvelopeFailure) {
    super(EnvelopeError.describe(failure));
    this.name = "EnvelopeError";
  }

  private static describe(failure: EnvelopeFailure): string {
    switch (failure) {
      case "bad-schema":
        return "not a CP/1 signed envelope";
      case "hash-mismatch":
        return "payload hash mismatch (tampered in transit)";
      case "signature-missing":
        return "fleet key configured but envelope is unsigned";
      case "signature-invalid":
        return "HMAC signature does not verify";
      case "no-key-to-verify":
        return "envelope is signed but no fleet key is configured";
      case "malformed-payload":
        return "payload is not valid JSON";
      case "not-canonical":
        return "payload is not in CP/1 canonical form";
      case "seal-broken":
        return "document content_hash does not match its content";
    }
  }
}

function hmacHex(key: Buffer | string, message: string): string {
  return createHmac("sha256", key).update(message, "utf8").digest("hex");
}

/**
 * Wrap a document for transport, sealing it first.
 *
 * @throws {CanonicalError} if the document cannot be canonically encoded, which
 * for CP/1 means it contains a float, a null or an undefined.
 */
export function sealEnvelope(
  document: Record<string, unknown>,
  fleetKey?: Buffer | string,
): SignedEnvelope {
  const sealed = seal(document);
  const payload = toCanonical(sealed);
  const digest = sha256Hex(payload);
  return {
    cp: "cp1",
    schema: ENVELOPE_SCHEMA,
    payload,
    sha256: digest,
    ...(fleetKey === undefined ? {} : { hmac: hmacHex(fleetKey, digest) }),
  };
}

/**
 * Verify an envelope and return the document it carries.
 *
 * Checks run outermost-first — schema, transport hash, signature, then the
 * document's own seal — so the cheapest rejection happens first.
 *
 * @throws {EnvelopeError} on any verification failure.
 */
export function openEnvelope(
  envelope: SignedEnvelope,
  fleetKey?: Buffer | string,
): Record<string, unknown> {
  if (envelope?.cp !== "cp1" || envelope?.schema !== ENVELOPE_SCHEMA) {
    throw new EnvelopeError("bad-schema");
  }
  if (sha256Hex(envelope.payload) !== envelope.sha256) {
    throw new EnvelopeError("hash-mismatch");
  }

  if (fleetKey !== undefined && envelope.hmac === undefined) {
    throw new EnvelopeError("signature-missing");
  }
  if (fleetKey === undefined && envelope.hmac !== undefined) {
    throw new EnvelopeError("no-key-to-verify");
  }
  if (fleetKey !== undefined && envelope.hmac !== undefined) {
    const expected = Buffer.from(hmacHex(fleetKey, envelope.sha256), "utf8");
    const actual = Buffer.from(envelope.hmac, "utf8");
    // Comparing with === would leak, through timing, how many leading bytes of
    // a forged MAC were correct — enough to reconstruct one byte at a time.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new EnvelopeError("signature-invalid");
    }
  }

  let document: Record<string, unknown>;
  try {
    document = JSON.parse(envelope.payload) as Record<string, unknown>;
  } catch {
    throw new EnvelopeError("malformed-payload");
  }

  try {
    if (toCanonical(document) !== envelope.payload) {
      throw new EnvelopeError("not-canonical");
    }
  } catch (err) {
    if (err instanceof CanonicalError) throw new EnvelopeError("not-canonical");
    throw err;
  }

  if (!verifySeal(document)) {
    throw new EnvelopeError("seal-broken");
  }
  return document;
}

/**
 * Render an envelope as one line of the line-delimited JSON transport.
 *
 * The envelope itself is canonical too, so a reader can hash whole lines for a
 * transport-level audit trail.
 */
export function toLine(envelope: SignedEnvelope): string {
  return toCanonical(envelope as unknown as Record<string, unknown>);
}

/** Parse one line of the line-delimited JSON transport. */
export function fromLine(line: string): SignedEnvelope {
  try {
    return JSON.parse(line) as SignedEnvelope;
  } catch {
    throw new EnvelopeError("bad-schema");
  }
}
