import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CanonicalError,
  CP1_VERSION,
  checkCorpus,
  checkManifest,
  compareUtf8,
  contentHash,
  describeFailures,
  EnvelopeError,
  fromLine,
  isTimestamp,
  openEnvelope,
  seal,
  sealEnvelope,
  sha256Hex,
  timestamp,
  toBasisPoints,
  toCanonical,
  toLine,
  toSignedBasisPoints,
  verifySeal,
} from "../src/protocol/index.js";
import { EVENT_EMITTER, EVENT_KINDS } from "../src/protocol/types.js";

const vendored = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(`../protocol/cp1/${relative}`, import.meta.url)), "utf8");

const CORPUS = vendored("fixtures/canonical.jsonl");
const MANIFEST = vendored("MANIFEST.sha256");

describe("CP/1 conformance", () => {
  it("agrees with the normative fixture corpus", () => {
    const failures = checkCorpus(CORPUS);
    expect(
      failures,
      `EVE's binding disagrees with the normative CP/1 corpus:\n${describeFailures(failures)}`,
    ).toEqual([]);
  });

  it("verifies the vendored corpus against the normative manifest", () => {
    // This is what catches a stale vendored copy. Without it the round-trip
    // checks above would pass happily against the wrong contract.
    //
    // Every manifest entry is supplied, `SPEC.md` included: an entry with no
    // matching vendored file is reported as drift, so omitting one here would
    // be a failure, not a silent skip.
    expect(
      checkManifest(MANIFEST, {
        "fixtures/canonical.jsonl": CORPUS,
        VERSION: vendored("VERSION"),
        "SPEC.md": vendored("SPEC.md"),
        "schema/cp1.schema.json": vendored("schema/cp1.schema.json"),
      }),
    ).toEqual([]);
  });

  it("declares the protocol version the vendored copy actually carries", () => {
    // `CP1_VERSION` is what EVE reports to a peer negotiating the protocol. If
    // it drifted from the vendored VERSION, EVE would claim conformance to a
    // revision it does not implement.
    expect(CP1_VERSION).toBe(vendored("VERSION").trim());
  });

  it("has a non-empty corpus", () => {
    // A conformance suite that silently passes on an empty corpus is worse than
    // no suite: it reports success while testing nothing.
    const documents = CORPUS.split("\n").filter((line) => line.trim() !== "");
    expect(documents).toHaveLength(14);
  });

  it("reports a document whose bytes are not canonical", () => {
    const reordered = '{"type":"Identity","cp":"cp1","id":"x","provenance":{}}';
    expect(checkCorpus(reordered).some((f) => f.detail.includes("re-encoding changed"))).toBe(true);
  });

  it("reports a float where basis points are required", () => {
    const withFloat =
      '{"confidence_bp":0.82,"cp":"cp1","id":"x","provenance":{"authored_by":"adam","content_hash":"","derived_from":[],"evidence":[],"origin":"o","produced_at":"p"},"type":"Belief"}';
    expect(checkCorpus(withFloat).some((f) => f.detail.includes("must be an integer"))).toBe(true);
  });

  it("reports a basis-point value outside its range", () => {
    const outOfRange =
      '{"confidence_bp":20000,"cp":"cp1","id":"x","provenance":{"authored_by":"adam","content_hash":"","derived_from":[],"evidence":[],"origin":"o","produced_at":"p"},"type":"Belief"}';
    expect(
      checkCorpus(outOfRange).some((f) => f.detail.includes("outside the basis-point range")),
    ).toBe(true);
  });

  it("reports missing coverage of a canonical type", () => {
    expect(checkCorpus("").some((f) => f.detail.includes("no fixture covers"))).toBe(true);
  });

  it("detects a stale vendored copy", () => {
    const failures = checkManifest(`${"0".repeat(64)}  fixtures/canonical.jsonl\n`, {
      "fixtures/canonical.jsonl": "stale",
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("re-vendor");
  });

  it("reports when no vendored path matches the manifest", () => {
    const failures = checkManifest(`${"0".repeat(64)}  fixtures/canonical.jsonl\n`, {
      "some/other/path": "x",
    });
    expect(failures[0]).toContain("drifted");
  });
});

describe("canonical form", () => {
  it("sorts object keys at every depth and preserves array order", () => {
    expect(toCanonical({ b: 1, a: [3, 1, { d: 4, c: 2 }] })).toBe(
      '{"a":[3,1,{"c":2,"d":4}],"b":1}',
    );
  });

  it("keeps non-ASCII literal and uses short escapes", () => {
    expect(toCanonical({ s: 'a"b\\c\nd\te—f' })).toBe('{"s":"a\\"b\\\\c\\nd\\te—f"}');
  });

  it("rejects a float, naming where it is", () => {
    expect(() => toCanonical({ outer: { fitness: 0.5 } })).toThrow(CanonicalError);
    expect(() => toCanonical({ outer: { fitness: 0.5 } })).toThrow("$.outer.fitness");
  });

  it("rejects null and undefined rather than encoding them", () => {
    expect(() => toCanonical({ x: null })).toThrow("omits absent values");
    expect(() => toCanonical({ x: undefined })).toThrow("omit the key instead");
  });

  it("rejects an integer outside the safe range", () => {
    expect(() => toCanonical({ n: 2 ** 53 })).toThrow("outside the safe range");
  });

  it("orders keys by UTF-8 bytes, not UTF-16 code units", () => {
    // The two orderings disagree beyond the BMP. U+1D11E is a surrogate pair
    // (D834 DD1E) in UTF-16, so the default comparator sorts it *below*
    // U+FFFD; in UTF-8 its lead byte is F0, which sorts *above* EF. A binding
    // that used `.sort()` would emit different bytes — and a different
    // content_hash — than the Rust and Python bindings for this document.
    const document = { "\u{1d11e}": 1, "�": 2, tone: 3 };
    // The default comparator and the CP/1 one disagree, and this is where.
    expect(Object.keys(document).sort()).toEqual(["tone", "\u{1d11e}", "�"]);
    expect(Object.keys(document).sort(compareUtf8)).toEqual(["tone", "�", "\u{1d11e}"]);
    expect(toCanonical(document)).toBe(`{"tone":3,"�":2,"\u{1d11e}":1}`);
  });

  it("compares strings byte-wise, including across the BMP boundary", () => {
    expect(compareUtf8("�", "\u{1d11e}")).toBeLessThan(0);
    expect(compareUtf8("\u{1d11e}", "�")).toBeGreaterThan(0);
    expect(compareUtf8("a", "a")).toBe(0);
    // ASCII, where the two orderings agree, must be unaffected.
    expect(compareUtf8("a", "b")).toBeLessThan(0);
    expect(compareUtf8("Z", "a")).toBeLessThan(0);
  });

  it("the vendored corpus exercises that ordering", () => {
    // A rule with no fixture behind it is a rule the next binding can get
    // wrong silently. Assert the astral key is actually in the corpus.
    expect(CORPUS).toContain("\u{1d11e}");
  });
});

describe("sealing", () => {
  const document = () => ({
    cp: "cp1",
    type: "Belief",
    id: "55555555-5555-4555-8555-555555555555",
    statement: "tests catch regressions",
    provenance: {
      authored_by: "adam",
      produced_at: "2026-01-01T00:00:00.000Z",
      origin: "reasoning",
      evidence: [],
      derived_from: [],
      content_hash: "",
    },
  });

  it("round-trips and detects tampering", () => {
    const sealed = seal(document());
    expect(verifySeal(sealed)).toBe(true);
    expect(verifySeal({ ...sealed, statement: "tests miss regressions" })).toBe(false);
  });

  it("is idempotent — a recorded hash never feeds the next hash", () => {
    const once = seal(document());
    expect(seal(once).provenance.content_hash).toBe(once.provenance.content_hash);
  });

  it("excludes only the hash itself, so evidence cannot be substituted freely", () => {
    const base = document();
    const withEvidence = {
      ...base,
      provenance: { ...base.provenance, evidence: ["a log line"] },
    };
    expect(contentHash(base)).not.toBe(contentHash(withEvidence));
  });

  it("never verifies a document with no provenance hash", () => {
    expect(verifySeal({ statement: "x" })).toBe(false);
  });
});

describe("basis points", () => {
  it("rounds half away from zero and clamps out-of-range input", () => {
    expect(toBasisPoints(0.00005)).toBe(1);
    expect(toBasisPoints(0.5)).toBe(5000);
    expect(toBasisPoints(1.5)).toBe(10000);
    expect(toBasisPoints(-0.2)).toBe(0);
    expect(toBasisPoints(Number.NaN)).toBe(0);
  });

  it("carries sign for deltas", () => {
    expect(toSignedBasisPoints(-0.07)).toBe(-700);
    expect(toSignedBasisPoints(0.07)).toBe(700);
    expect(toSignedBasisPoints(-5)).toBe(-10000);
  });

  it("round-trips every representable value", () => {
    for (const raw of [0, 1, 1234, 5000, 9999, 10000]) {
      expect(toBasisPoints(raw / 10000)).toBe(raw);
    }
  });
});

describe("timestamps", () => {
  it("emits exactly millisecond precision", () => {
    expect(isTimestamp(timestamp())).toBe(true);
    expect(timestamp(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });

  it("rejects other precisions, which would hash differently across bindings", () => {
    expect(isTimestamp("2026-01-01T00:00:00Z")).toBe(false);
    expect(isTimestamp("2026-01-01T00:00:00.123456Z")).toBe(false);
    expect(isTimestamp("2026-01-01T00:00:00.123+00:00")).toBe(false);
  });
});

describe("signed envelope", () => {
  const document = () =>
    seal({
      cp: "cp1",
      type: "Belief",
      id: "55555555-5555-4555-8555-555555555555",
      statement: "tests catch regressions",
      provenance: {
        authored_by: "adam",
        produced_at: "2026-01-01T00:00:00.000Z",
        origin: "reasoning",
        evidence: [],
        derived_from: [],
        content_hash: "",
      },
    });

  it("round-trips unsigned", () => {
    const opened = openEnvelope(sealEnvelope(document()));
    expect(opened.statement).toBe("tests catch regressions");
  });

  it("round-trips signed under the same key", () => {
    const envelope = sealEnvelope(document(), "fleet-secret");
    expect(envelope.hmac).toBeDefined();
    expect(() => openEnvelope(envelope, "fleet-secret")).not.toThrow();
  });

  it("refuses a different key", () => {
    const envelope = sealEnvelope(document(), "fleet-secret");
    expect(() => openEnvelope(envelope, "other-secret")).toThrow(EnvelopeError);
  });

  it("refuses an unsigned envelope when a key is required", () => {
    expect(() => openEnvelope(sealEnvelope(document()), "fleet-secret")).toThrow("unsigned");
  });

  it("refuses a signed envelope when no key is configured", () => {
    expect(() => openEnvelope(sealEnvelope(document(), "k"))).toThrow("no fleet key");
  });

  it("catches payload tampering via the transport hash", () => {
    const envelope = sealEnvelope(document());
    const tampered = { ...envelope, payload: envelope.payload.replace("catch", "misss") };
    expect(() => openEnvelope(tampered)).toThrow("tampered in transit");
  });

  it("catches a consistently rehashed payload via the document seal", () => {
    // The interesting attack: edit the payload AND recompute the transport
    // hash, which anyone can do on an unsigned envelope. The document's own
    // content_hash is the layer that stops it, which is why CP/1 has both.
    //
    // The replacement is the same length as what it replaces, so the payload
    // stays in canonical form and the `not-canonical` check does not fire
    // first — the assertion has to reach the seal check to mean anything.
    const envelope = sealEnvelope(document());
    const payload = envelope.payload.replace("catch", "misss");
    expect(payload).not.toBe(envelope.payload);
    expect(() => openEnvelope({ ...envelope, payload, sha256: sha256Hex(payload) })).toThrow(
      "content_hash does not match its content",
    );
  });

  it("round-trips over the line protocol without embedded newlines", () => {
    const envelope = sealEnvelope(document(), "k");
    const line = toLine(envelope);
    expect(line).not.toContain("\n");
    expect(fromLine(line)).toEqual(envelope);
  });
});

describe("event catalog", () => {
  it("assigns every event to exactly one emitting component", () => {
    for (const kind of EVENT_KINDS) {
      expect(EVENT_EMITTER[kind], `${kind} has no declared emitter`).toBeDefined();
    }
    expect(new Set(Object.values(EVENT_EMITTER))).toEqual(new Set(["adam", "eve", "axiom"]));
  });

  it("is closed at fourteen events", () => {
    // Adding an event is a CP/1 version change: consumers switch exhaustively
    // over the set, so an addition silently creates untested branches.
    expect(EVENT_KINDS).toHaveLength(14);
  });
});
