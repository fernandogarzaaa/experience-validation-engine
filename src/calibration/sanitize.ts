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

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(Bearer|bearer)\s+[A-Za-z0-9\-._~+/=]{8,}/g;
const API_KEY_RE = /\b(api[_-]?key|apikey|client[_-]?secret)\b\s*[:=]\s*\S+/gi;
const TOKEN_BLOB_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const SECRET_KEY_RE = /passw|passwd|passport|secret|token|api[_-]?key|auth|credential|ssn/i;

export const REDACTED_EMAIL = "[redacted:email]";
export const REDACTED_SECRET = "[redacted:secret]";

/** Redact emails, bearer tokens, api keys, and token-like blobs in text. */
export function redactTextSecrets(text: string): string {
  return text
    .replace(EMAIL_RE, REDACTED_EMAIL)
    .replace(BEARER_RE, `Bearer ${REDACTED_SECRET}`)
    .replace(API_KEY_RE, REDACTED_SECRET)
    .replace(TOKEN_BLOB_RE, REDACTED_SECRET);
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
 * Normalize a traced URL for dataset storage: origin + path plus ONLY
 * state-bearing query values (via the same semantic classification EVE
 * uses internally). High-cardinality values — session ids, tracking
 * tokens, search text — never enter the dataset.
 */
export function sanitizeTraceUrl(url: string): string {
  try {
    const u = new URL(url);
    const query = classifiedQuery(url);
    return `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
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

/** Sanitize one per-step human record (targets, labels, self-reports). */
export function sanitizeHumanStep(step: HumanStep): HumanStep {
  return {
    ...step,
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
          selfReport: Object.fromEntries(
            Object.entries(step.selfReport).map(([k, v]) => [
              isSecretFieldName(k) ? REDACTED_SECRET : k,
              v,
            ]),
          ),
        }
      : {}),
  };
}
