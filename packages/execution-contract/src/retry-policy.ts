/**
 * ADR-0452 section 3: one bounded retry contract for outbound delivery, replica cycles, knowledge
 * jobs, and supervision dispatch. Automatic attempts stop at `attentionAfter`; a counter above
 * `maximumAttempts` means the owning store let an attempt run past the contract ceiling.
 */
export interface RetryBackoff {
  initialDelayMs: number;
  multiplier: number;
  maximumDelayMs: number;
}

export interface RetryPolicy {
  maximumAttempts: number;
  attentionAfter: number;
  backoff: RetryBackoff;
}

export type RetryAttentionReason =
  "attempts_exhausted" | "attempt_ceiling_exceeded" | "non_retryable_failure";

export type RetryAdmission =
  | { status: "admitted"; attemptCount: number }
  | { status: "attention_required"; reason: RetryAttentionReason; attemptCount: number };

export type RetryFailureDecision =
  | { status: "retry_scheduled"; attemptCount: number; delayMs: number }
  | { status: "attention_required"; reason: RetryAttentionReason; attemptCount: number };

export class RetryPolicyError extends Error {
  readonly code = "invalid_retry_policy";

  constructor(message: string) {
    super(message);
    this.name = "RetryPolicyError";
  }
}

export const maximumRetryPolicyAttempts = 100;
export const maximumRetryPolicyDelayMs = 86_400_000;

function boundedInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

export function assertRetryPolicy(policy: RetryPolicy): void {
  const { backoff } = policy;
  if (
    !boundedInteger(policy.maximumAttempts, 1, maximumRetryPolicyAttempts) ||
    !boundedInteger(policy.attentionAfter, 1, policy.maximumAttempts) ||
    !boundedInteger(backoff.initialDelayMs, 0, maximumRetryPolicyDelayMs) ||
    !boundedInteger(backoff.maximumDelayMs, backoff.initialDelayMs, maximumRetryPolicyDelayMs) ||
    !Number.isFinite(backoff.multiplier) ||
    backoff.multiplier < 1 ||
    backoff.multiplier > 10
  ) {
    throw new RetryPolicyError("The retry policy is outside its bounded contract.");
  }
}

function assertAttemptCount(attemptCount: number): void {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RetryPolicyError("The retry attempt count must be a positive integer.");
  }
}

function exhaustedReason(policy: RetryPolicy, attemptCount: number): RetryAttentionReason {
  return attemptCount > policy.maximumAttempts ? "attempt_ceiling_exceeded" : "attempts_exhausted";
}

/** Decides whether the counted attempt about to run may run; it never admits one past `attentionAfter`. */
export function admitRetryAttempt(policy: RetryPolicy, attemptCount: number): RetryAdmission {
  assertRetryPolicy(policy);
  assertAttemptCount(attemptCount);
  return attemptCount <= policy.attentionAfter
    ? { status: "admitted", attemptCount }
    : { status: "attention_required", reason: exhaustedReason(policy, attemptCount), attemptCount };
}

/** Decides the next step after a counted attempt failed. */
export function decideRetryAfterFailure(
  policy: RetryPolicy,
  input: { attemptCount: number; retryable: boolean },
): RetryFailureDecision {
  assertRetryPolicy(policy);
  assertAttemptCount(input.attemptCount);
  if (input.attemptCount >= policy.attentionAfter) {
    return {
      status: "attention_required",
      reason: exhaustedReason(policy, input.attemptCount),
      attemptCount: input.attemptCount,
    };
  }
  if (!input.retryable) {
    return {
      status: "attention_required",
      reason: "non_retryable_failure",
      attemptCount: input.attemptCount,
    };
  }
  const { initialDelayMs, multiplier, maximumDelayMs } = policy.backoff;
  const delayMs = Math.min(
    maximumDelayMs,
    Math.round(initialDelayMs * multiplier ** (input.attemptCount - 1)),
  );
  return { status: "retry_scheduled", attemptCount: input.attemptCount, delayMs };
}
