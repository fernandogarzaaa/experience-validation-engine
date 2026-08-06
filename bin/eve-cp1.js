#!/usr/bin/env node
/**
 * EVE's CP/1 validation endpoint.
 *
 * Reads line-delimited CP/1 request envelopes on stdin and writes response
 * envelopes on stdout. ADAM spawns this to measure a mutation; see
 * `protocol/cp1/SPEC.md` section 6.
 *
 * stdout carries the protocol and nothing else — diagnostics go to stderr, so a
 * stray log line can never be parsed as a response.
 */
import { serve } from "../dist/fitness/index.js";

const fleetKey = process.env.CP1_FLEET_KEY;

serve({
  ...(fleetKey ? { fleetKey } : {}),
  onLog: (line) => process.stderr.write(`[eve-cp1] ${line}\n`),
}).catch((err) => {
  process.stderr.write(`[eve-cp1] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
