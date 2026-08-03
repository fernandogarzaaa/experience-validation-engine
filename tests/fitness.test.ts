import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  applyDeltas,
  DEFAULT_SCENARIO_IDS,
  explainUnprojectable,
  handleEnvelope,
  listScenarios,
  project,
  resolveScenarios,
  serve,
  validateMutation,
} from "../src/fitness/index.js";
import { BASELINE_TRAITS } from "../src/personas/persona.js";
import { seal } from "../src/protocol/canonical.js";
import { openEnvelope, sealEnvelope } from "../src/protocol/envelope.js";
import type { FitnessResult, Mutation, ValidationRequest } from "../src/protocol/types.js";

function mutation(overrides: Partial<Mutation> = {}): Mutation {
  return seal({
    cp: "cp1",
    type: "Mutation",
    id: randomUUID(),
    kind: "amend_genome",
    target: "preferences.thoroughness",
    current_value: "low",
    proposed_value: "high",
    rationale: "the operator misses information it needed",
    confidence_bp: 7000,
    risk_bp: 2000,
    status: "proposed",
    provenance: {
      authored_by: "adam",
      produced_at: "2026-01-01T00:00:00.000Z",
      origin: "evolution:analyze",
      evidence: [],
      derived_from: [],
      content_hash: "",
    },
    ...overrides,
  } as unknown as Record<string, unknown>) as unknown as Mutation;
}

function request(overrides: Partial<ValidationRequest> = {}): ValidationRequest {
  return seal({
    cp: "cp1",
    type: "ValidationRequest",
    id: randomUUID(),
    mutation: mutation(),
    genome_before_hash: "a".repeat(64),
    genome_after_hash: "b".repeat(64),
    scenario_ids: ["excellent"],
    seed: 1337,
    trials: 1,
    provenance: {
      authored_by: "adam",
      produced_at: "2026-01-01T00:00:00.000Z",
      origin: "adam:evolution/validate",
      evidence: [],
      derived_from: [],
      content_hash: "",
    },
    ...overrides,
  } as unknown as Record<string, unknown>) as unknown as ValidationRequest;
}

describe("mutation projection", () => {
  it("projects a declared preference onto its operator traits", () => {
    const projection = project(mutation({ target: "preferences.thoroughness" }));
    expect(projection?.deltas.map((d) => d.trait)).toEqual(["thoroughness"]);
    expect(projection?.deltas[0]?.amount).toBeGreaterThan(0);
  });

  it("projects a preference onto every trait it drives", () => {
    const projection = project(mutation({ target: "preferences.exploration" }));
    expect(projection?.deltas.map((d) => d.trait).sort()).toEqual(["curiosity", "experimentation"]);
  });

  it("reverses direction when a preference is lowered", () => {
    const raised = project(mutation({ current_value: "low", proposed_value: "high" }));
    const lowered = project(mutation({ current_value: "high", proposed_value: "low" }));
    expect(raised?.deltas[0]?.amount).toBeGreaterThan(0);
    expect(lowered?.deltas[0]?.amount).toBeLessThan(0);
  });

  it("accepts a numeric intensity as readily as an ordinal", () => {
    expect(project(mutation({ current_value: "0.2", proposed_value: "0.9" }))).not.toBeNull();
  });

  it("declines a preference value it cannot interpret", () => {
    // Defaulting to a midpoint here would silently measure something the
    // proposal did not ask for.
    expect(project(mutation({ proposed_value: "chartreuse" }))).toBeNull();
    expect(explainUnprojectable(mutation({ proposed_value: "chartreuse" }))).toContain(
      "not an intensity",
    );
  });

  it("declines a preference with no declared operational meaning", () => {
    const m = mutation({ target: "preferences.tone", proposed_value: "high" });
    expect(project(m)).toBeNull();
    expect(explainUnprojectable(m)).toContain("no declared operational projection");
  });

  it("declines a no-op amendment", () => {
    expect(project(mutation({ current_value: "high", proposed_value: "high" }))).toBeNull();
  });

  it("projects a policy through its declared keyword", () => {
    const projection = project(
      mutation({ target: "policies.append", proposed_value: "always verify before acting" }),
    );
    expect(projection?.deltas[0]?.trait).toBe("thoroughness");
    expect(projection?.deltas[0]?.amount).toBeGreaterThan(0);
  });

  it("reverses a policy's effect when the policy is removed", () => {
    const added = project(mutation({ target: "policies.append", proposed_value: "always verify" }));
    const removed = project(
      mutation({ target: "policies.remove", current_value: "always verify" }),
    );
    expect(removed?.deltas[0]?.amount).toBe(-(added?.deltas[0]?.amount ?? 0));
  });

  it("declines a policy matching no declared keyword", () => {
    const m = mutation({ target: "policies.append", proposed_value: "be excellent" });
    expect(project(m)).toBeNull();
    expect(explainUnprojectable(m)).toContain("matched no declared operational keyword");
  });

  it("projects skill retirement as lost fluency", () => {
    const projection = project(mutation({ kind: "retire_skill", target: "rust-debugging" }));
    expect(projection?.deltas[0]?.trait).toBe("techLiteracy");
    expect(projection?.deltas[0]?.amount).toBeLessThan(0);
  });

  it("declines goals and values, which change what is pursued and not how", () => {
    for (const target of ["goals.append", "values.append", "capabilities.append"]) {
      const m = mutation({ target, proposed_value: "survive model replacement" });
      expect(project(m), target).toBeNull();
      expect(explainUnprojectable(m)).toContain("rather than how it operates");
    }
  });

  it("declines advisory mutations, which apply no change to observe", () => {
    for (const kind of ["reconcile_belief", "investigate_conflict"] as const) {
      const m = mutation({ kind, target: "some statement" });
      expect(project(m), kind).toBeNull();
      expect(explainUnprojectable(m)).toContain("advisory");
    }
  });

  it("clamps traits to their range when a delta would overshoot", () => {
    const traits = applyDeltas(BASELINE_TRAITS, [
      { trait: "thoroughness", amount: 5 },
      { trait: "patience", amount: -5 },
    ]);
    expect(traits.thoroughness).toBe(1);
    expect(traits.patience).toBe(0);
  });

  it("scales the one absolute trait proportionally rather than additively", () => {
    // A +0.2 delta against a value near 240 would be meaningless as an addition.
    const traits = applyDeltas(BASELINE_TRAITS, [{ trait: "readingSpeedWpm", amount: 0.5 }]);
    expect(traits.readingSpeedWpm).toBeCloseTo(BASELINE_TRAITS.readingSpeedWpm * 1.5);
  });
});

describe("scenario registry", () => {
  it("ships the three construct-validated reference apps", () => {
    expect(
      listScenarios()
        .map((s) => s.id)
        .sort(),
    ).toEqual(["average", "bad", "excellent"]);
    expect([...DEFAULT_SCENARIO_IDS].sort()).toEqual(["average", "bad", "excellent"]);
  });

  it("fails on an unknown scenario rather than silently measuring fewer", () => {
    expect(() => resolveScenarios(["excellent", "nope"])).toThrow('unknown scenario "nope"');
  });
});

describe("validateMutation", () => {
  it("escalates an unmeasurable mutation instead of scoring it", async () => {
    const result = await validateMutation(
      request({ mutation: mutation({ kind: "reconcile_belief", target: "x" }) }),
    );
    expect(result.recommendation).toBe("needs_review");
    expect(result.reason).toContain("not measurable by simulation");
    // Nothing ran, so neither side may claim a measurement.
    expect(result.baseline).toEqual(result.candidate);
    expect(result.delta_bp).toBe(0);
  });

  it("produces a sealed, well-formed CP/1 document", async () => {
    const result = await validateMutation(
      request({ mutation: mutation({ kind: "investigate_conflict", target: "identity" }) }),
    );
    expect(result.cp).toBe("cp1");
    expect(result.type).toBe("FitnessResult");
    expect(result.provenance.authored_by).toBe("eve");
    expect(result.provenance.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records the seed both runs used, so the comparison is checkable", async () => {
    const result = await validateMutation(request({ seed: 4242 }), { maxSteps: 6 });
    expect(result.seed).toBe(4242);
    expect(result.provenance.evidence).toContain("seed=4242");
  });

  it("rejects a request naming an unknown scenario", async () => {
    await expect(validateMutation(request({ scenario_ids: ["nope"] }))).rejects.toThrow(
      "unknown scenario",
    );
  });

  it("measures a real mutation counterfactually and reproducibly", {
    timeout: 180_000,
  }, async () => {
    const req = request({ scenario_ids: ["excellent"], seed: 99, trials: 1 });
    const options = { panel: ["first-time-user"], maxSteps: 25 };

    const first = await validateMutation(req, options);
    const second = await validateMutation(req, options);

    // Determinism is what makes the counterfactual valid: baseline and
    // candidate differ only by the mutation, and a rerun differs by nothing.
    expect(second.baseline).toEqual(first.baseline);
    expect(second.candidate).toEqual(first.candidate);
    expect(second.delta_bp).toBe(first.delta_bp);

    expect(first.baseline.runs).toBeGreaterThan(0);
    expect(first.candidate.runs).toBe(first.baseline.runs);
    expect(first.delta_bp).toBe(first.candidate.composite_bp - first.baseline.composite_bp);
    expect(["approve", "needs_review", "reject"]).toContain(first.recommendation);
    expect(first.reason).toContain("seeded runs");
  });

  it("withholds approval from a high-risk mutation even when it measures well", {
    timeout: 180_000,
  }, async () => {
    const highRisk = request({
      mutation: mutation({ risk_bp: 9500 }),
      scenario_ids: ["excellent"],
      seed: 99,
      trials: 1,
    });
    const result = await validateMutation(highRisk, {
      panel: ["first-time-user"],
      maxSteps: 25,
      // Force the aggregate past the approval floor so risk is the only
      // thing that can still hold it back.
      thresholds: { approveDeltaBp: -10000, rejectDeltaBp: -10001 },
    });
    expect(result.recommendation).toBe("needs_review");
    expect(result.reason).toContain("intrinsic risk");
  });
});

describe("CP/1 validation endpoint", () => {
  const unmeasurable = () =>
    request({ mutation: mutation({ kind: "reconcile_belief", target: "x" }) });

  it("answers a well-formed request with a sealed FitnessResult envelope", async () => {
    const response = await handleEnvelope(
      sealEnvelope(unmeasurable() as unknown as Record<string, unknown>),
    );
    expect("payload" in response).toBe(true);
    const result = openEnvelope(response as never) as unknown as FitnessResult;
    expect(result.type).toBe("FitnessResult");
    expect(result.mutation_id).toBeDefined();
  });

  it("round-trips under a fleet key", async () => {
    const response = await handleEnvelope(
      sealEnvelope(unmeasurable() as unknown as Record<string, unknown>, "secret"),
      { fleetKey: "secret" },
    );
    expect(() => openEnvelope(response as never, "secret")).not.toThrow();
  });

  it("refuses an envelope signed with the wrong key", async () => {
    const response = await handleEnvelope(
      sealEnvelope(unmeasurable() as unknown as Record<string, unknown>, "wrong"),
      { fleetKey: "right" },
    );
    expect(response).toMatchObject({ type: "ProtocolError" });
    expect((response as { detail: string }).detail).toContain("HMAC");
  });

  it("refuses a document that is not a ValidationRequest", async () => {
    const response = await handleEnvelope(
      sealEnvelope(mutation() as unknown as Record<string, unknown>),
    );
    expect(response).toMatchObject({ type: "ProtocolError" });
    expect((response as { detail: string }).detail).toContain("expected a ValidationRequest");
  });

  it("refuses a mutation not authored by ADAM", async () => {
    // Only ADAM may mint a Mutation. A request carrying one attributed to
    // anything else is asking EVE to bless a proposal that never went through
    // ADAM's evolution engine.
    const forged = unmeasurable();
    const tampered = {
      ...forged,
      mutation: {
        ...forged.mutation,
        provenance: { ...forged.mutation.provenance, authored_by: "eve" },
      },
    };
    const response = await handleEnvelope(
      sealEnvelope(tampered as unknown as Record<string, unknown>),
    );
    expect(response).toMatchObject({ type: "ProtocolError" });
    expect((response as { detail: string }).detail).toContain("only ADAM may author");
  });

  it("refuses a request with a non-integer seed", async () => {
    const response = await handleEnvelope(
      sealEnvelope({
        ...(unmeasurable() as unknown as Record<string, unknown>),
        seed: "1337",
      }),
    );
    expect((response as { detail: string }).detail).toContain("seed must be an integer");
  });

  it("reports a failed measurement as a protocol error, not a verdict", async () => {
    // Returning a FitnessResult here would tell ADAM simulation had an opinion
    // when it never ran.
    const response = await handleEnvelope(
      sealEnvelope({
        ...(request({ scenario_ids: ["nope"] }) as unknown as Record<string, unknown>),
      }),
    );
    expect(response).toMatchObject({ type: "ProtocolError" });
    expect((response as { detail: string }).detail).toContain("unknown scenario");
  });

  it("serves the line protocol end to end", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    const running = serve({ input, output });
    input.write(
      `${JSON.stringify(sealEnvelope(unmeasurable() as unknown as Record<string, unknown>))}\n`,
    );
    // A blank line is keepalive and must not provoke a response.
    input.write("\n");
    input.end();
    await running;

    const lines = chunks
      .join("")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    const result = openEnvelope(JSON.parse(lines[0] as string)) as unknown as FitnessResult;
    expect(result.type).toBe("FitnessResult");
  });

  it("answers an unparseable line without terminating the stream", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));

    const running = serve({ input, output });
    input.write("this is not json\n");
    input.write(
      `${JSON.stringify(sealEnvelope(unmeasurable() as unknown as Record<string, unknown>))}\n`,
    );
    input.end();
    await running;

    const lines = chunks
      .join("")
      .split("\n")
      .filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string).type).toBe("ProtocolError");
    expect(JSON.parse(lines[1] as string).schema).toBe("cp1_signed_envelope");
  });
});
