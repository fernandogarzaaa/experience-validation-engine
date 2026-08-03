/**
 * CP/1 canonical form — the byte-exact encoding every document hashes over.
 *
 * `JSON.stringify` is close but not canonical: it emits members in insertion
 * order, and CP/1 requires them sorted by UTF-16 code unit. This module imposes
 * that ordering, reusing `JSON.stringify` only for scalar rendering, whose
 * escaping rules (escape `"`, `\` and `U+0000`–`U+001F`, using `\b \f \n \r \t`
 * where they exist, leaving non-ASCII literal) already match the specification.
 *
 * Non-integer numbers are rejected rather than rendered. CP/1 puts no floating
 * point on the wire, so encountering one means a caller built a document that
 * will hash differently in the Rust bindings — failing here is far better than
 * emitting bytes the other side will reject.
 *
 * See `protocol/cp1/SPEC.md` section 2.
 */

import { createHash } from "node:crypto";

/** A JSON value CP/1 permits. Note the absence of `null`. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

export class CanonicalError extends Error {
  constructor(
    message: string,
    /** Where in the document the problem is, e.g. `$.baseline.composite_bp`. */
    readonly path: string,
  ) {
    super(`${message} at ${path}`);
    this.name = "CanonicalError";
  }
}

/**
 * Render a value in CP/1 canonical form.
 *
 * @throws {CanonicalError} if the value contains a non-integer number, a
 * `null`, an `undefined`, or a type JSON cannot represent.
 */
export function toCanonical(value: unknown): string {
  return write(value, "$");
}

function write(value: unknown, path: string): string {
  if (value === null) {
    throw new CanonicalError("CP/1 omits absent values rather than writing null", path);
  }
  if (value === undefined) {
    throw new CanonicalError("undefined cannot be encoded; omit the key instead", path);
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isInteger(value)) {
        throw new CanonicalError(
          `CP/1 permits integers only, found ${value}; ratios cross the wire as basis points`,
          path,
        );
      }
      // Number.isInteger admits ±2^53 and beyond, where JSON.stringify would
      // still render exactly but Rust's i64 parse would silently differ from
      // what a reader expects. Nothing in CP/1 legitimately reaches this range.
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalError(`integer ${value} is outside the safe range`, path);
      }
      return String(value);

    case "string":
      return JSON.stringify(value);

    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, i) => write(item, `${path}[${i}]`)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const members = keys.map(
        (key) => `${JSON.stringify(key)}:${write(record[key], `${path}.${key}`)}`,
      );
      return `{${members.join(",")}}`;
    }

    default:
      throw new CanonicalError(`${typeof value} cannot be encoded as JSON`, path);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * SHA-256 over the canonical form of `document` with `provenance.content_hash`
 * removed — a document cannot commit to its own hash.
 *
 * Everything else is inside the hash on purpose, including evidence and
 * `derived_from`: the provenance chain is only unforgeable if substituting the
 * evidence changes the hash (SPEC.md section 4.1).
 */
export function contentHash(document: Record<string, unknown>): string {
  const unsealed = stripHash(document);
  return sha256Hex(toCanonical(unsealed));
}

function stripHash(document: Record<string, unknown>): Record<string, unknown> {
  const provenance = document.provenance;
  if (typeof provenance !== "object" || provenance === null) return { ...document };
  const { content_hash: _omitted, ...rest } = provenance as Record<string, unknown>;
  return { ...document, provenance: rest };
}

/**
 * Return a copy of `document` with `provenance.content_hash` set to its true
 * value. Sealing is idempotent: a previously recorded hash is stripped before
 * the new one is computed.
 */
export function seal<T extends Record<string, unknown>>(document: T): T {
  const hash = contentHash(document);
  const provenance = document.provenance;
  if (typeof provenance !== "object" || provenance === null) return { ...document };
  return {
    ...document,
    provenance: { ...(provenance as Record<string, unknown>), content_hash: hash },
  };
}

/** Whether the document's recorded `content_hash` equals its true hash. */
export function verifySeal(document: Record<string, unknown>): boolean {
  const provenance = document.provenance as Record<string, unknown> | undefined;
  const recorded = provenance?.content_hash;
  if (typeof recorded !== "string") return false;
  return recorded === contentHash(document);
}

/**
 * A ratio in [0,1] as an integer in [0,10000].
 *
 * Clamping rather than throwing is right at this boundary: scores from
 * statistical models can land a hair outside [0,1] through accumulated error,
 * and refusing to encode a 1.0000001 would fail a pipeline over nothing.
 * Rounding is half away from zero, matching the Rust bindings.
 */
export function toBasisPoints(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  // Math.round is half-up, which for the non-negative clamped range is
  // identical to half-away-from-zero.
  return Math.round(clamped * 10000);
}

/** A signed ratio in [-1,1] as an integer in [-10000,10000]. */
export function toSignedBasisPoints(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  const clamped = Math.min(1, Math.max(-1, ratio));
  const scaled = Math.round(Math.abs(clamped) * 10000);
  return clamped < 0 ? -scaled : scaled;
}

/** Convert basis points back to a ratio. */
export function fromBasisPoints(bp: number): number {
  return bp / 10000;
}

/**
 * The current instant as RFC 3339 UTC with exactly millisecond precision.
 *
 * Fixed precision is a hashing requirement: a timestamp one binding renders
 * with microseconds and another with seconds produces two different content
 * hashes for the same document. `toISOString` already emits exactly this shape.
 */
export function timestamp(at: Date = new Date()): string {
  return at.toISOString();
}

const TIMESTAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Whether a string matches CP/1's fixed timestamp shape. */
export function isTimestamp(value: string): boolean {
  return TIMESTAMP_SHAPE.test(value);
}
