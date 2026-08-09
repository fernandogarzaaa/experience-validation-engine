#!/usr/bin/env node
/**
 * Re-vendor the CP/1 normative source from AXIOM-AETHER.
 *
 * EVE implements a hand-written CP/1 binding and verifies it against the shared
 * fixture corpus. That corpus is a *copy*: there is no build-time dependency on
 * AXIOM-AETHER, which is what lets three repositories in three languages ship
 * on independent cadences. The cost is that the copy has to be refreshed when
 * the protocol changes, and this script is how.
 *
 *   node scripts/vendor-protocol.mjs [path-to-AXIOM-AETHER]
 *
 * Defaults to a sibling checkout at `../AXIOM-AETHER`. After running, execute
 * `npm test -- tests/protocol.test.ts`: the manifest check will pass only if the
 * copy is byte-identical to the source, and the conformance checks will fail if
 * EVE's binding does not implement whatever changed.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EVE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = resolve(EVE_ROOT, "..", "AXIOM-AETHER");

/**
 * Files a binding must carry verbatim. Mirrors MANIFEST.sha256's entries.
 *
 * `SPEC.md` is here because the manifest hashes it: the normative text is part
 * of what a binding claims to conform to, and a copy that drifts from the
 * source would let this repository cite a specification nobody else is reading.
 */
const VENDORED = [
  "VERSION",
  "MANIFEST.sha256",
  "SPEC.md",
  "schema/cp1.schema.json",
  "fixtures/canonical.jsonl",
];

const sourceRoot = join(resolve(process.argv[2] ?? DEFAULT_SOURCE), "protocol", "cp1");
const targetRoot = join(EVE_ROOT, "protocol", "cp1");

if (!existsSync(sourceRoot)) {
  console.error(
    `No CP/1 source at ${sourceRoot}.\n` +
      "Pass the path to an AXIOM-AETHER checkout:\n" +
      "  node scripts/vendor-protocol.mjs /path/to/AXIOM-AETHER",
  );
  process.exit(1);
}

for (const relative of VENDORED) {
  const from = join(sourceRoot, relative);
  const to = join(targetRoot, relative);
  if (!existsSync(from)) {
    console.error(`missing in source: ${relative}`);
    process.exit(1);
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`vendored ${relative}`);
}

const version = readFileSync(join(targetRoot, "VERSION"), "utf8").trim();
console.log(
  `\nCP/1 ${version} vendored from ${sourceRoot}.\n` +
    "Run `npm test -- tests/protocol.test.ts` to confirm this binding still conforms.",
);
