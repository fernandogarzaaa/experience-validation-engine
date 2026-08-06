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
 * 5. **Provenance edges** — `derived_from` ids resolve within the corpus;
 *    `baseline.runs` equals `candidate.runs`; and a measured `FitnessResult`
 *    references a `SimulationCompleted` whose `subject_id` and reported run
 *    counts match. Catches a measurement that cannot be chained back to the
 *    specific run that produced it — including one that cites a real run for
 *    the wrong mutation, or the wrong count — which is indistinguishable from
 *    a fabricated one.
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

  failures.push(...provenanceEdgeProblems(corpus));
  return failures;
}

/**
 * Check 5: `derived_from` edges resolve, run counts agree, and a measured
 * `FitnessResult` names — and matches — the run that produced it.
 *
 * See `protocol/cp1/SPEC.md` section 4.2. A `FitnessResult` asserts that
 * baseline and candidate each ran n times at a given seed; without a reference
 * to the `SimulationCompleted` that produced those runs, a measured result and
 * a fabricated one are structurally identical and the receiver cannot tell
 * them apart. This is the one place a component reports on work only it can
 * see, which is where the chain has to be checkable rather than conventional.
 *
 * Naming *a* `SimulationCompleted` is not enough — it must be *the* one. A
 * reference is checked three ways: it resolves within the corpus, its
 * `subject_id` matches this result's `mutation_id` (a real event for a
 * different mutation says nothing about this one), and its reported run
 * counts match `baseline.runs`/`candidate.runs` (otherwise a result claiming
 * 90 runs could cite a real event that ran once). Order in `derived_from`
 * carries no meaning, so every referenced `SimulationCompleted` is a
 * candidate, not just the first one found — the edge is satisfied the moment
 * any of them matches.
 *
 * An `id` must be unique within the corpus: two documents sharing one make any
 * reference to it ambiguous, so a duplicate is reported rather than silently
 * resolved to whichever was seen last.
 *
 * Scoped to the corpus on purpose: a binding cannot resolve an id it was never
 * given, so an edge pointing outside the supplied set is not a failure.
 */
function provenanceEdgeProblems(corpus: string): ConformanceFailure[] {
  const failures: ConformanceFailure[] = [];
  const docById = new Map<string, Record<string, unknown>>();
  const rows: { line: number; documentType: string; id: string; derived: string[] }[] = [];

  corpus.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    let document: Record<string, unknown>;
    try {
      document = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // Already reported by check 1.
    }
    const id = document.id;
    if (typeof id !== "string") return;
    const lineNumber = index + 1;

    if (docById.has(id)) {
      failures.push({
        line: lineNumber,
        documentType: typeof document.type === "string" ? document.type : "?",
        detail: "id also used by an earlier document; a derived_from reference to it is ambiguous",
      });
      return;
    }
    docById.set(id, document);

    const provenance = document.provenance as Record<string, unknown> | undefined;
    const derivedFrom = provenance?.derived_from;
    const derived = Array.isArray(derivedFrom)
      ? derivedFrom.filter((v): v is string => typeof v === "string")
      : [];
    rows.push({
      line: lineNumber,
      documentType: typeof document.type === "string" ? document.type : "?",
      id,
      derived,
    });
  });

  for (const row of rows) {
    if (row.derived.includes(row.id)) {
      failures.push({
        line: row.line,
        documentType: row.documentType,
        detail: "derives from itself, which is not a provenance edge",
      });
    }

    if (row.documentType !== "FitnessResult") continue;
    const document = docById.get(row.id) as Record<string, unknown>;

    const baseline = document.baseline as Record<string, unknown> | undefined;
    const candidate = document.candidate as Record<string, unknown> | undefined;
    const baselineRuns = typeof baseline?.runs === "number" ? baseline.runs : 0;
    const candidateRuns = typeof candidate?.runs === "number" ? candidate.runs : 0;

    if (baselineRuns !== candidateRuns) {
      failures.push({
        line: row.line,
        documentType: row.documentType,
        detail:
          `baseline.runs (${baselineRuns}) and candidate.runs (${candidateRuns}) disagree; ` +
          "a counterfactual is valid only when both sides ran the same number of times " +
          "(SPEC.md section 4.2)",
      });
    }

    // A result reporting no runs is the honest encoding of "EVE declined to
    // measure this". There is no simulation for it to name, and demanding one
    // would force it to invent the very reference this rule exists to make
    // meaningful.
    if (baselineRuns === 0 && candidateRuns === 0) continue;

    // Order in derived_from carries no meaning, and nothing forbids a result
    // from also referencing an unrelated SimulationCompleted (a memory citing
    // several runs, say). So every referenced completion is evaluated rather
    // than stopping at the first one: the edge is satisfied the moment any of
    // them matches both mutation_id and the reported run counts.
    const completions = row.derived
      .map((ref) => docById.get(ref))
      .filter((doc): doc is Record<string, unknown> => doc?.type === "SimulationCompleted");

    if (completions.length === 0) {
      failures.push({
        line: row.line,
        documentType: row.documentType,
        detail:
          "provenance.derived_from names no SimulationCompleted; a measurement that cannot " +
          "be chained back to its run is indistinguishable from a fabricated one " +
          "(SPEC.md section 4.2)",
      });
      continue;
    }

    const satisfied = completions.some((run) => {
      const payload = run.payload as Record<string, unknown> | undefined;
      return (
        run.subject_id === document.mutation_id &&
        payload?.baseline_runs === baselineRuns &&
        payload?.candidate_runs === candidateRuns
      );
    });

    if (!satisfied) {
      failures.push({
        line: row.line,
        documentType: row.documentType,
        detail:
          `${completions.length} referenced SimulationCompleted event(s) exist, but none has ` +
          `subject_id=${JSON.stringify(document.mutation_id)} with baseline_runs=${baselineRuns} ` +
          `and candidate_runs=${candidateRuns}; a real run for a different mutation or count is ` +
          "not evidence about this result (SPEC.md section 4.2)",
      });
    }
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
