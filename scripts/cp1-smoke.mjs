#!/usr/bin/env node
/**
 * Smoke-test EVE's CP/1 validation endpoint over the real transport.
 *
 * Spawns `bin/eve-cp1.js` exactly as ADAM does — a subprocess speaking
 * line-delimited JSON on stdio — sends one signed ValidationRequest, and checks
 * the response is a verifiable FitnessResult.
 *
 * The unit tests exercise `handleEnvelope` directly, which is faster but skips
 * everything that can only break in a real process: the built `dist/` layout,
 * the bin shim's import path, stdout framing, and the rule that diagnostics go
 * to stderr so they can never be parsed as protocol.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { seal } = await import(`${ROOT}/dist/protocol/canonical.js`);
const { openEnvelope, sealEnvelope } = await import(`${ROOT}/dist/protocol/envelope.js`);

const provenance = (origin) => ({
  authored_by: "adam",
  produced_at: "2026-01-01T00:00:00.000Z",
  origin,
  evidence: [],
  derived_from: [],
  content_hash: "",
});

// A preference amendment with a declared operational projection, so the
// endpoint runs a real counterfactual measurement rather than escalating.
const mutation = seal({
  cp: "cp1",
  type: "Mutation",
  id: randomUUID(),
  kind: "amend_genome",
  target: "preferences.thoroughness",
  current_value: "low",
  proposed_value: "high",
  rationale: "smoke test",
  confidence_bp: 7000,
  risk_bp: 2000,
  status: "proposed",
  provenance: provenance("evolution:analyze"),
});

const request = seal({
  cp: "cp1",
  type: "ValidationRequest",
  id: randomUUID(),
  mutation,
  genome_before_hash: "a".repeat(64),
  genome_after_hash: "b".repeat(64),
  scenario_ids: ["excellent"],
  seed: 1337,
  trials: 1,
  provenance: provenance("adam:evolution/validate"),
});

const child = spawn(process.execPath, [`${ROOT}/bin/eve-cp1.js`], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.stdin.write(`${JSON.stringify(sealEnvelope(request))}\n`);
child.stdin.end();

const code = await new Promise((done) => child.on("close", done));

const fail = (message) => {
  console.error(`✗ ${message}`);
  if (stderr) console.error(`  stderr: ${stderr.trim()}`);
  process.exit(1);
};

if (code !== 0) fail(`endpoint exited with code ${code}`);

const lines = stdout.split("\n").filter((line) => line.trim() !== "");
if (lines.length !== 1) fail(`expected exactly one response line, got ${lines.length}`);

let result;
try {
  result = openEnvelope(JSON.parse(lines[0]));
} catch (err) {
  fail(`response did not verify: ${err.message}`);
}

if (result.type !== "FitnessResult") fail(`expected a FitnessResult, got ${result.type}`);
if (result.mutation_id !== mutation.id) fail("result does not reference the requested mutation");
if (result.seed !== request.seed) fail("result does not record the requested seed");
if (result.provenance.authored_by !== "eve") fail("result is not attributed to EVE");
if (result.baseline.runs < 1 || result.candidate.runs !== result.baseline.runs) {
  fail("baseline and candidate must be measured over the same number of runs");
}
if (result.delta_bp !== result.candidate.composite_bp - result.baseline.composite_bp) {
  fail("delta_bp does not equal candidate minus baseline");
}

console.log(
  `✓ CP/1 endpoint: ${result.recommendation} (${result.delta_bp >= 0 ? "+" : ""}${result.delta_bp}bp` +
    ` over ${result.baseline.runs} runs)\n  ${result.reason}`,
);
