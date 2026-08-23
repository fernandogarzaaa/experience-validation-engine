#!/usr/bin/env node
/**
 * `npm audit --omit=dev --audit-level=high` is the CI's blocking gate on
 * what ships to real users — but `playwright`, `puppeteer`,
 * `selenium-webdriver` and `@anthropic-ai/sdk` are optional *peer*
 * dependencies (real users who enable a browser adapter or LLM cognition
 * install them directly) that are *also* devDependencies here, so their
 * hand-written duck-typed adapter interfaces get checked against the real
 * packages in CI (see package.json). npm marks a package installed only via
 * devDependencies as "dev" in the lockfile regardless of its parallel
 * peerDependencies entry, so `--omit=dev` silently excludes a high/critical
 * advisory in any of them from the blocking gate — exactly the packages
 * most worth catching, since they reach production installs.
 *
 * This script re-parses a full `npm audit` and fails if any of them carry a
 * high/critical advisory, independent of npm's dev/prod classification.
 */
import { execFileSync } from "node:child_process";

const WATCHED_PACKAGES = ["playwright", "puppeteer", "selenium-webdriver", "@anthropic-ai/sdk"];
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

function runAudit() {
  try {
    return JSON.parse(
      execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    );
  } catch (error) {
    // `npm audit` exits non-zero as soon as it finds anything; the JSON
    // report is still on stdout in that case.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const report = runAudit();
const vulnerabilities = report.vulnerabilities ?? {};

const findings = [];
for (const name of WATCHED_PACKAGES) {
  const entry = vulnerabilities[name];
  if (entry && BLOCKING_SEVERITIES.has(entry.severity)) {
    findings.push(`${name}: ${entry.severity} (vulnerable range: ${entry.range ?? "unknown"})`);
  }
}

if (findings.length > 0) {
  console.error(
    "Blocking: high/critical advisory in an optional peer dependency that ships to real users:",
  );
  for (const finding of findings) console.error(`  - ${finding}`);
  console.error(
    "\nThese packages are devDependencies (in addition to peerDependencies) so their duck-typed\n" +
      "adapters get checked against the real thing in CI. That makes npm mark them \"dev\" in the\n" +
      "lockfile, which `npm audit --omit=dev` treats as out of scope for the blocking gate — but a\n" +
      "real user installs them as a plain (non-dev) peer dependency and is exposed regardless.",
  );
  process.exit(1);
}

console.log(
  `No high/critical advisories in watched peer dependencies (${WATCHED_PACKAGES.join(", ")}).`,
);
