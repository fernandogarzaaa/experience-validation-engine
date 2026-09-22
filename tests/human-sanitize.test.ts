import { describe, expect, it } from "vitest";
import {
  isSecretFieldName,
  REDACTED_EMAIL,
  REDACTED_SECRET,
  redactTextSecrets,
  sanitizeHumanStep,
  sanitizeHumanStudy,
  sanitizeHumanTrace,
  sanitizeTraceUrl,
} from "../src/calibration/index.js";

describe("human-trace sanitization (Phase 15)", () => {
  it("redacts emails, bearer tokens, api keys, and token blobs", () => {
    expect(redactTextSecrets("contact jane.doe@example.com now")).toContain(REDACTED_EMAIL);
    expect(redactTextSecrets("auth Bearer abcdefgh12345678 end")).toContain(REDACTED_SECRET);
    expect(redactTextSecrets("api_key: sk-live-1234 here")).toContain(REDACTED_SECRET);
    expect(redactTextSecrets("id 9f8e7d6c5b4a39485746352413098765 done")).toContain(
      REDACTED_SECRET,
    );
    // Ordinary prose survives untouched.
    expect(redactTextSecrets("clicked the save button twice")).toBe(
      "clicked the save button twice",
    );
  });

  it("flags secret field names conservatively", () => {
    for (const name of ["password", "passwd", "client_secret", "apiKey", "authToken", "ssn"]) {
      expect(isSecretFieldName(name)).toBe(true);
    }
    expect(isSecretFieldName("username")).toBe(false);
    expect(isSecretFieldName("passport-number")).toBe(true); // over-redaction is auditable
  });

  it("keeps state-bearing query values, buckets tracking and secrets", () => {
    const clean = sanitizeTraceUrl("https://shop.test/d?tab=settings&session=abc123&token=xyz");
    expect(clean).toContain("tab=settings");
    // High-cardinality values collapse to length buckets — structure kept,
    // content never enters the dataset.
    expect(clean).not.toContain("abc123");
    expect(clean).not.toContain("xyz");
    expect(clean).toContain("session=s");
  });

  it("sanitizes aggregate traces (paths + abandonment screen)", () => {
    const out = sanitizeHumanTrace({
      completed: false,
      path: ["https://x.test/?session=aaa", "https://x.test/pay"],
      steps: 4,
      abandonedOn: "https://x.test/pay?token=zzz",
    });
    expect(out.path[0]).toBe("https://x.test/?session=s");
    expect(out.abandonedOn).toBe("https://x.test/pay?token=s");
    const study = sanitizeHumanStudy({ task: "t", traces: [out] });
    expect(study.traces).toHaveLength(1);
  });

  it("sanitizes per-step records including secret targets and reports", () => {
    const out = sanitizeHumanStep({
      index: 0,
      target: "password",
      actionLabel: "typed hunter2@example.com",
      selfReport: { confidence: 0.7, ssn: 1 },
    });
    expect(out.target).toBe(REDACTED_SECRET);
    expect(out.actionLabel).toContain(REDACTED_EMAIL);
    expect(out.selfReport).toEqual({ confidence: 0.7, [REDACTED_SECRET]: 1 });
  });

  it("is idempotent", () => {
    const once = sanitizeHumanTrace({
      completed: true,
      path: ["https://x.test/?a=b&session=zzz", "user@example.com"],
    });
    expect(sanitizeHumanTrace(once)).toEqual(once);
    const step = sanitizeHumanStep({ index: 0, actionLabel: "a@b.co" });
    expect(sanitizeHumanStep(step)).toEqual(step);
  });
});
