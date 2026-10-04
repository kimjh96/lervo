import { describe, expect, it } from "vitest";

import {
  admitRetryAttempt,
  decideRetryAfterFailure,
  RetryPolicyError,
  type RetryPolicy,
} from "../src/retry-policy.js";

const policy: RetryPolicy = {
  maximumAttempts: 5,
  attentionAfter: 3,
  backoff: { initialDelayMs: 1_000, multiplier: 2, maximumDelayMs: 3_000 },
};

describe("retry policy", () => {
  it("schedules bounded backoff until attentionAfter and then requires attention", () => {
    expect(decideRetryAfterFailure(policy, { attemptCount: 1, retryable: true })).toEqual({
      status: "retry_scheduled",
      attemptCount: 1,
      delayMs: 1_000,
    });
    expect(decideRetryAfterFailure(policy, { attemptCount: 2, retryable: true })).toEqual({
      status: "retry_scheduled",
      attemptCount: 2,
      delayMs: 2_000,
    });
    expect(decideRetryAfterFailure(policy, { attemptCount: 3, retryable: true })).toEqual({
      status: "attention_required",
      reason: "attempts_exhausted",
      attemptCount: 3,
    });
    expect(decideRetryAfterFailure(policy, { attemptCount: 1, retryable: false })).toEqual({
      status: "attention_required",
      reason: "non_retryable_failure",
      attemptCount: 1,
    });
  });

  it("caps exponential delay at maximumDelayMs", () => {
    const wide = { ...policy, attentionAfter: 5 };
    expect(decideRetryAfterFailure(wide, { attemptCount: 4, retryable: true })).toMatchObject({
      delayMs: 3_000,
    });
  });

  it("never lets a failing retry loop exceed attentionAfter", () => {
    let attempts = 0;
    for (let cycle = 0; cycle < 20_589; cycle += 1) {
      const admission = admitRetryAttempt(policy, attempts + 1);
      if (admission.status === "attention_required") break;
      attempts = admission.attemptCount;
      const decision = decideRetryAfterFailure(policy, { attemptCount: attempts, retryable: true });
      if (decision.status === "attention_required") break;
    }
    expect(attempts).toBe(policy.attentionAfter);
  });

  it("refuses attempts past attentionAfter and flags counters above the ceiling", () => {
    expect(admitRetryAttempt(policy, 3)).toEqual({ status: "admitted", attemptCount: 3 });
    expect(admitRetryAttempt(policy, 4)).toEqual({
      status: "attention_required",
      reason: "attempts_exhausted",
      attemptCount: 4,
    });
    expect(admitRetryAttempt(policy, 20_589)).toEqual({
      status: "attention_required",
      reason: "attempt_ceiling_exceeded",
      attemptCount: 20_589,
    });
  });

  it("rejects unbounded or inconsistent policies and invalid counters", () => {
    for (const invalid of [
      { ...policy, maximumAttempts: 0 },
      { ...policy, maximumAttempts: 101 },
      { ...policy, attentionAfter: 6 },
      { ...policy, backoff: { ...policy.backoff, multiplier: 0.5 } },
      { ...policy, backoff: { ...policy.backoff, maximumDelayMs: 500 } },
    ]) {
      expect(() => admitRetryAttempt(invalid, 1)).toThrow(RetryPolicyError);
    }
    expect(() => admitRetryAttempt(policy, 0)).toThrow(RetryPolicyError);
    expect(() => decideRetryAfterFailure(policy, { attemptCount: 1.5, retryable: true })).toThrow(
      RetryPolicyError,
    );
  });
});
