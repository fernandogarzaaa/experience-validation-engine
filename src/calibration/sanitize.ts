import type { CanonicalSurfaceIdentity } from "../memory/surfaceIdentity.js";
import { classifiedQuery } from "../memory/surfaceIdentity.js";
import type { HumanStep } from "./alignment.js";
import type { HumanStudy, HumanTrace } from "./types.js";

/**
 * Human-trace sanitization boundary (Phase 15 data-governance substrate).
 *
 * Real human traces are the next likely stage, and the ingestion path
 * (`importHumanStudy`) currently trusts callers that data is "anonymized"
 * without enforcing anything. This module is the enforcement point:
 * sanitize BEFORE a human dataset is accepted for calibration.
 *
 * MUST be redacted before acceptance (see docs/human-calibration.md):
 * email addresses, bearer/API tokens and token-like secrets, password or
 * secret field contents (by key name AND by pattern), high-cardinality
 * URL query values (session ids, tracking tokens), and raw screenshot
 * bytes (never ingest images into trace datasets — use derived features).
 *
 * Sanitization is deterministic and idempotent: sanitizing twice yields
 * the same output as once. It never invents data — redactions are explicit
 * `[redacted:*]` markers, so downstream analysis can distinguish redacted
 * from absent.
 */

/**
 * Linear-time email pattern, used ANCHORED per whitespace-delimited token
 * (see `redactEmails`). A global scan with any `@`-containing pattern is
 * quadratic on hostile input: at every start position the engine consumes
 * a long run before failing on the missing `@`/`.`, for O(n²) total.
 * Anchored full-token tests are O(token) each — linear overall.
 */
const EMAIL_TOKEN_RE = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;
const LEAD_PUNCT_RE = /^[([{"']+/;
const TRAIL_PUNCT_RE = /[!?,;:.)\]]+$/;
const BEARER_RE = /\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/=]{8,}/g;
const API_KEY_RE = /\b(api[_-]?key|apikey|client[_-]?secret)\b\s*[:=]\s*\S+/gi;
const TOKEN_BLOB_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const SECRET_KEY_RE = /passw|passwd|passport|secret|token|api[_-]?key|auth|credential|ssn/i;

export const REDACTED_EMAIL = "[redacted:email]";
export const REDACTED_SECRET = "[redacted:secret]";

/** Redact emails, bearer tokens, api keys, and token-like blobs in text. */
export function redactTextSecrets(text: string): string {
  return redactEmails(text)
    .replace(BEARER_RE, `Bearer ${REDACTED_SECRET}`)
    .replace(API_KEY_RE, REDACTED_SECRET)
    .replace(TOKEN_BLOB_RE, REDACTED_SECRET);
}

/**
 * Email redaction in linear time: split on whitespace, test each token
 * ANCHORED (full-token match, surrounding punctuation stripped and
 * restored). A global unanchored scan is O(n²) on hostile input because
 * every start position consumes a long run before failing.
 */
function redactEmails(text: string): string {
  return text
    .split(/(\s+)/g)
    .map((tok) => {
      if (tok === "" || /^\s+$/.test(tok)) return tok;
      const lead = (tok.match(LEAD_PUNCT_RE) ?? [""])[0]!;
      const rest = tok.slice(lead.length);
      const trail = (rest.match(TRAIL_PUNCT_RE) ?? [""])[0]!;
      const core = trail ? rest.slice(0, -trail.length) : rest;
      return EMAIL_TOKEN_RE.test(core) ? `${lead}${REDACTED_EMAIL}${trail}` : tok;
    })
    .join("");
}

/**
 * True when a field name suggests secret content (form field names,
 * JSON keys, self-report labels). Conservative by design: over-redaction
 * is auditable, under-redaction is a breach.
 */
export function isSecretFieldName(name: string): boolean {
  return SECRET_KEY_RE.test(name);
}

/**
 * Normalize a traced URL for dataset storage: origin + scrubbed path plus
 * ONLY state-bearing query values (via the same semantic classification
 * EVE uses internally). Path segments are scrubbed for emails/secrets —
 * human paths routinely embed identifiers (`/users/jane@x.com`). High-
 * cardinality query values — session ids, tracking tokens, search text —
 * never enter the dataset.
 */
export function sanitizeTraceUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname
      .split("/")
      .map((seg) => redactTextSecrets(seg))
      .join("/");
    const query = classifiedQuery(url);
    return `${u.origin}${path}${query ? `?${query}` : ""}`;
  } catch {
    return redactTextSecrets(url);
  }
}

function sanitizePath(path: readonly string[]): readonly string[] {
  return path.map(sanitizeTraceUrl);
}

/** Sanitize one aggregate human trace (paths, abandonment screen). */
export function sanitizeHumanTrace(trace: HumanTrace): HumanTrace {
  return {
    ...trace,
    path: sanitizePath(trace.path),
    ...(trace.abandonedOn ? { abandonedOn: sanitizeTraceUrl(trace.abandonedOn) } : {}),
  };
}

/** Sanitize a full human study. Deterministic and idempotent. */
export function sanitizeHumanStudy(study: HumanStudy): HumanStudy {
  return {
    ...study,
    traces: study.traces.map(sanitizeHumanTrace),
  };
}

/** Sanitize a nested canonical state reference (no field escapes scrutiny). */
export function sanitizeCanonicalState(state: CanonicalSurfaceIdentity): CanonicalSurfaceIdentity {
  return {
    ...state,
    ...(state.taskId ? { taskId: redactTextSecrets(state.taskId) } : {}),
    ...(state.url ? { url: sanitizeTraceUrl(state.url) } : {}),
    ...(state.externalStateId ? { externalStateId: redactTextSecrets(state.externalStateId) } : {}),
  };
}

/** Sanitize one per-step human record (targets, labels, self-reports). */
export function sanitizeHumanStep(step: HumanStep): HumanStep {
  return {
    ...step,
    ...(step.taskId ? { taskId: redactTextSecrets(step.taskId) } : {}),
    ...(step.state ? { state: sanitizeCanonicalState(step.state) } : {}),
    ...(step.url ? { url: sanitizeTraceUrl(step.url) } : {}),
    ...(step.target
      ? {
          target: isSecretFieldName(step.target) ? REDACTED_SECRET : redactTextSecrets(step.target),
        }
      : {}),
    ...(step.actionLabel ? { actionLabel: redactTextSecrets(step.actionLabel) } : {}),
    ...(step.outcome ? { outcome: redactTextSecrets(step.outcome) } : {}),
    ...(step.correction ? { correction: redactTextSecrets(step.correction) } : {}),
    ...(step.transitionTo ? { transitionTo: sanitizeTraceUrl(step.transitionTo) } : {}),
    ...(step.selfReport
      ? {
          // Secret-keyed entries are DROPPED, not renamed: renaming
          // preserves the value under a colliding marker key, which is
          // both a leak and data corruption.
          selfReport: Object.fromEntries(
            Object.entries(step.selfReport).filter(([k]) => !isSecretFieldName(k)),
          ),
        }
      : {}),
  };
}
