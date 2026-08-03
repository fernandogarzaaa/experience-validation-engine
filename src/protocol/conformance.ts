/**
 * The shared CP/1 conformance suite, as EVE runs it.
 *
 * Every binding, in every repository, runs the same checks against the same
 * golden corpus. That is the entire mechanism keeping three hand-written
 * bindings in three languages agreeing about the wire — there is no code
 * generation and no shared library to enforce it, so this is load-bearing.
 *
 * The checks and what each catches:
 *
 * 1. **Round trip** — parsing a fixture and re-encoding it reproduces the exact
 *    bytes. Catches key ordering, number rendering or escaping that differs
 *    from the normative source.
 * 2. **Seal** — each `provenance.content_hash` is the true hash of the document
 *    with that member removed. Catches hashing different bytes than are sent.
 * 3. **Structure** — required members present, `_bp` members integral and in
 *    range. Catches accepting a float where the protocol forbids one.
 * 4. **Manifest** — the vendored corpus hashes to what the normative source
 *    recorded. Catches running against a stale copy, which would make checks
 *    1–3 pass against the wrong contract.
 */

import { sha256Hex, toCanonical, verifySeal } from "./canonical.js";
import { EVENT_KINDS, type EventKind } from "./types.js";

export interface ConformanceFailure {
  /** 1-based line in the corpus, or 0 for a corpus-wide failure. */
  readonly line: number;
  readonly documentType: string;
  readonly detail: string;
}

const REQUIRED_PROVENANCE_MEMBERS = [
  "authored_by",
  "produced_at",
  "origin",
  "evidence",
  "derived_from",
  "content_hash",
] as const;

/** Every canonical type the corpus must cover. */
const CANONICAL_TYPES = [
  "Identity",
  "Genome",
  "Capability",
  "Belief",
  "Memory",
  "Skill",
  "Mutation",
  "Reflection",
  "Observation",
  "Experience",
  "FitnessResult",
  "Context",
  "ValidationRequest",
] as const;

const EVENT_KIND_SET: ReadonlySet<string> = new Set<string>(EVENT_KINDS);

export function isEventKind(value: string): value is EventKind {
  return EVENT_KIND_SET.has(value);
}

/** Run checks 1–3 over a fixture corpus (the contents of `canonical.jsonl`). */
export function checkCorpus(corpus: string): ConformanceFailure[] {
  const failures: ConformanceFailure[] = [];
  const seenTypes = new Set<string>();

  corpus.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "") return;

    let document: Record<string, unknown>;
    try {
      document = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      failures.push({
        line: lineNumber,
        documentType: "?",
        detail: `not valid JSON: ${(err as Error).message}`,
      });
      return;
    }

    const documentType = typeof document.type === "string" ? document.type : "?";
    seenTypes.add(isEventKind(documentType) ? "Event" : documentType);

    const fail = (detail: string): void => {
      failures.push({ line: lineNumber, documentType, detail });
    };

    // 1. Round trip.
    try {
      const reencoded = toCanonical(document);
      if (reencoded !== line) {
        fail(`re-encoding changed the bytes:\n    read:  ${line}\n    wrote: ${reencoded}`);
      }
    } catch (err) {
      fail(`could not be canonicalized: ${(err as Error).message}`);
    }

    // 2. Seal.
    try {
      if (!verifySeal(document)) {
        fail("provenance.content_hash does not match the document's content");
      }
    } catch (err) {
      fail(`seal could not be checked: ${(err as Error).message}`);
    }

    // 3. Structure.
    for (const detail of structuralProblems(document)) fail(detail);
  });

  // Coverage: a corpus missing a type would let that type's encoding drift in
  // every binding at once, undetected.
  for (const expected of CANONICAL_TYPES) {
    if (!seenTypes.has(expected)) {
      failures.push({
        line: 0,
        documentType: expected,
        detail: "no fixture covers this canonical type",
      });
    }
  }
  if (!seenTypes.has("Event")) {
    failures.push({
      line: 0,
      documentType: "Event",
      detail: "no fixture covers the event envelope",
    });
  }

  return failures;
}

function structuralProblems(document: Record<string, unknown>): string[] {
  const problems: string[] = [];

  if (document.cp !== "cp1") problems.push('`cp` must be the string "cp1"');
  if (typeof document.id !== "string") problems.push("`id` must be a string");

  const provenance = document.provenance;
  if (typeof provenance !== "object" || provenance === null) {
    problems.push("`provenance` must be an object");
  } else {
    const record = provenance as Record<string, unknown>;
    for (const member of REQUIRED_PROVENANCE_MEMBERS) {
      if (!(member in record)) problems.push(`provenance is missing \`${member}\``);
    }
    if (!["adam", "eve", "axiom"].includes(record.authored_by as string)) {
      problems.push("provenance.authored_by must be one of adam, eve, axiom");
    }
  }

  walkBasisPoints(document, "$", problems);
  return problems;
}

/**
 * The only members the schema declares as `signedBasisPoints`.
 *
 * Everything else ending in `_bp` is a plain `basisPoints`, whose range starts
 * at zero. A range wider than the schema's would let this binding accept a
 * document the contract forbids, and only the normative repository would notice.
 */
const SIGNED_BASIS_POINT_MEMBERS: ReadonlySet<string> = new Set(["delta_bp"]);

/**
 * Every member whose name ends in `_bp` must be an integer in range.
 *
 * Checked by name rather than by schema position so a new basis-point member is
 * covered the moment it appears in a fixture; an enumerated list would silently
 * fail open on additions.
 */
function walkBasisPoints(value: unknown, path: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      walkBasisPoints(item, `${path}[${i}]`, problems);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key.endsWith("_bp")) {
      const low = SIGNED_BASIS_POINT_MEMBERS.has(key) ? -10000 : 0;
      if (typeof child !== "number" || !Number.isInteger(child)) {
        problems.push(`${childPath} ends in \`_bp\` and must be an integer, found ${child}`);
      } else if (child < low || child > 10000) {
        problems.push(`${childPath} is ${child}, outside the basis-point range [${low}, 10000]`);
      }
    }
    walkBasisPoints(child, childPath, problems);
  }
}

/**
 * Check 4: verify vendored files against the normative manifest.
 *
 * `files` maps manifest-relative paths to the bytes this repository has. Paths
 * not supplied are skipped, so a binding that vendors only the fixtures need
 * not also carry `SPEC.md`.
 */
export function checkManifest(manifest: string, files: Readonly<Record<string, string>>): string[] {
  const failures: string[] = [];
  let matched = 0;

  for (const line of manifest.split("\n")) {
    if (line.trim() === "") continue;
    const separator = line.indexOf("  ");
    if (separator < 0) {
      // A manifest is an integrity control; silently skipping a line we cannot
      // parse would let a truncated manifest report success.
      failures.push(`malformed manifest line (expected \`<sha256>  <path>\`): ${line}`);
      continue;
    }
    const expected = line.slice(0, separator);
    const path = line.slice(separator + 2);
    const contents = files[path];
    if (contents === undefined) continue;

    matched += 1;
    const actual = sha256Hex(contents);
    if (actual !== expected) {
      failures.push(
        `${path}: manifest records ${expected.slice(0, 12)}…, vendored copy hashes ` +
          `${actual.slice(0, 12)}…  (re-vendor from the normative source in AXIOM-AETHER)`,
      );
    }
  }

  if (matched === 0) {
    failures.push(
      "no supplied file matched any manifest entry; the vendored paths have drifted from the manifest's",
    );
  }
  return failures;
}

/** Render failures as a single readable block for an assertion message. */
export function describeFailures(failures: readonly ConformanceFailure[]): string {
  return failures
    .map((f) => `  - fixture line ${f.line} (${f.documentType}): ${f.detail}`)
    .join("\n");
}
