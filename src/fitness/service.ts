/**
 * The CP/1 validation endpoint — how ADAM reaches EVE.
 *
 * ADAM spawns this as a subprocess, writes one line per {@link ValidationRequest}
 * and reads one line per {@link FitnessResult}. Line-delimited JSON over stdio
 * was chosen over HTTP because it needs no listener, no port allocation, no
 * service discovery and no authentication story for the common single-host
 * case — and because a subprocess boundary is a real isolation boundary for a
 * component whose job is running scenarios.
 *
 * Requests are handled strictly in order. Fitness measurement is CPU-bound
 * simulation, so concurrency would not shorten the wall clock, and serializing
 * keeps a request's stdout line unambiguously its own.
 *
 * See `protocol/cp1/SPEC.md` section 6.
 */

import { createInterface } from "node:readline";
import { openEnvelope, type SignedEnvelope, sealEnvelope } from "../protocol/envelope.js";
import type { FitnessResult, ValidationRequest } from "../protocol/types.js";
import { type ValidateOptions, validateMutation } from "./fitness.js";

export interface ServiceOptions extends ValidateOptions {
  /**
   * Shared secret for envelope signing. When set, incoming envelopes must carry
   * a valid HMAC and outgoing ones are signed. Unset is correct for the stdio
   * case, where the parent process already controls the child.
   */
  readonly fleetKey?: Buffer | string;
  /** Sink for diagnostics. Never stdout — that carries the protocol. */
  readonly onLog?: (line: string) => void;
}

/** A request that could not even be understood, reported in the same framing. */
export interface ProtocolError {
  readonly cp: "cp1";
  readonly type: "ProtocolError";
  readonly detail: string;
}

/**
 * Handle one request envelope, returning the response envelope.
 *
 * Exported separately from {@link serve} so the protocol behavior is testable
 * without spawning a process or touching stdio.
 */
export async function handleEnvelope(
  envelope: SignedEnvelope,
  options: ServiceOptions = {},
): Promise<SignedEnvelope | ProtocolError> {
  let document: Record<string, unknown>;
  try {
    document = openEnvelope(envelope, options.fleetKey);
  } catch (err) {
    return { cp: "cp1", type: "ProtocolError", detail: (err as Error).message };
  }

  const rejection = rejectIfNotAValidationRequest(document);
  if (rejection) return rejection;

  let result: FitnessResult;
  try {
    result = await validateMutation(document as unknown as ValidationRequest, options);
  } catch (err) {
    // A measurement that could not run (an unknown scenario, a persona that
    // does not exist) is a protocol-level error, not a fitness verdict.
    // Returning a FitnessResult here would tell ADAM that simulation had an
    // opinion when it never ran.
    return {
      cp: "cp1",
      type: "ProtocolError",
      detail: `measurement failed: ${(err as Error).message}`,
    };
  }

  return sealEnvelope(result as unknown as Record<string, unknown>, options.fleetKey);
}

/**
 * Validate the shape EVE depends on, before the measurement machinery sees it.
 *
 * The `authored_by` check is the important one: only ADAM may mint a Mutation
 * (CP/1 authorship is exclusive), so a request carrying a mutation attributed
 * to anything else is either a bug or an attempt to have EVE bless a proposal
 * that never went through ADAM's evolution engine.
 */
function rejectIfNotAValidationRequest(document: Record<string, unknown>): ProtocolError | null {
  const fail = (detail: string): ProtocolError => ({
    cp: "cp1",
    type: "ProtocolError",
    detail,
  });

  if (document.type !== "ValidationRequest") {
    return fail(`expected a ValidationRequest, received ${JSON.stringify(document.type)}`);
  }

  const mutation = document.mutation as Record<string, unknown> | undefined;
  if (mutation?.type !== "Mutation") {
    return fail("ValidationRequest.mutation is missing or is not a Mutation");
  }

  const author = (mutation.provenance as Record<string, unknown> | undefined)?.authored_by;
  if (author !== "adam") {
    return fail(
      `ValidationRequest.mutation was authored by ${JSON.stringify(author)}; only ADAM may author a Mutation`,
    );
  }

  if (typeof document.seed !== "number" || !Number.isInteger(document.seed)) {
    return fail("ValidationRequest.seed must be an integer; determinism depends on it");
  }

  if (typeof document.trials !== "number" || document.trials < 1) {
    return fail("ValidationRequest.trials must be at least 1");
  }

  return null;
}

/**
 * Run the endpoint over a pair of streams until the input closes.
 *
 * Blank lines are ignored so a caller may use them as keepalive without
 * provoking a response.
 */
export async function serve(
  options: ServiceOptions & {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const log = options.onLog ?? (() => {});

  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of lines) {
    if (line.trim() === "") continue;

    let envelope: SignedEnvelope;
    try {
      envelope = JSON.parse(line) as SignedEnvelope;
    } catch {
      write(output, {
        cp: "cp1",
        type: "ProtocolError",
        detail: "request line is not valid JSON",
      });
      continue;
    }

    const started = Date.now();
    const response = await handleEnvelope(envelope, options);
    log(`handled request in ${Date.now() - started}ms`);
    write(output, response);
  }
}

function write(output: NodeJS.WritableStream, value: SignedEnvelope | ProtocolError): void {
  output.write(`${JSON.stringify(value)}\n`);
}
