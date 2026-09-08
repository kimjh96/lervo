# ADR-0387: Terminal outcomes for conversation response failures

- Status: accepted
- Decision date: 2026-09-08

## Context

A Discord question reached intent resolution and produced a valid Codex response artifact, but writing publication repeatedly failed. The interaction runtime collapsed the responder error into `response_generation_failed`, retried without an attempt bound, and showed no terminal outcome. Later messages could complete while the original request remained silently active.

## Decision

The responder boundary preserves provider-neutral failure classifications. The installed Node distinguishes `response_generation_failed`, `response_evaluation_unavailable`, `response_writing_blocked`, `response_execution_invalid`, `response_contract_invalid`, and `publication_verification_failed`. Provider-specific error prose and payloads do not cross that boundary.

An unavailable or invalid semantic evaluator is distinct from a completed evaluation rejecting content. Evaluator unavailability retains the generated response artifact for bounded retry: a Claude evaluation failure does not rerun the Codex response. A completed rejection removes the candidate and permits one bounded regeneration attempt.

Each deployment sets `policy.maxResponseAttempts` from 1 through 10, defaulting to 3. Retryable failures are rescheduled only while the current claim attempt is below the bound. A non-retryable failure or exhausted retry budget creates one fixed multilingual status artifact, verifies it through a deterministic no-model writing contract, records a normal durable outbox message, and completes the inbox as `failed_terminal`. The static response includes only the attempt count and source event ID; it excludes prompt text, provider errors, credentials, model output, and unrestricted artifact locations.

The durable inbox retains the terminal failure code, failure time, and attempt count alongside its completed state. `failed_terminal` means response generation or publication did not complete and a verified explanatory message was queued; it does not prove platform delivery. The ordinary outbox delivery receipt separately proves delivery. Failure to store or verify the fixed terminal response is an interaction runtime failure, not another unbounded generation retry.

Retry selection uses availability time and bounded batches. Rescheduling places a failed item behind ready newer work; exhaustion prevents a permanently poisoned item from consuming future cycles.

## State and failure meaning

| State or code | Required fields | Meaning |
| --- | --- | --- |
| `retry_scheduled` | source event, role, failure code, attempt, next attempt time | Another bounded attempt may run; no reply has been queued |
| `failed_terminal` | source event, role, failure code, attempt count, fixed verified outbound | Generation or publication ended and an explanatory reply was queued |
| `response_writing_blocked` | source event, role, attempt, failure time | Generated content did not pass its writing contract |
| `response_evaluation_unavailable` | source event, role, attempt, failure time | The independent writing evaluator failed or returned an invalid contract; the generated artifact remains cached for retry |
| `response_execution_invalid` | source event, role, attempt, failure time | Managed execution evidence or independent session binding was invalid |
| `response_contract_invalid` | source event, role, attempt, failure time | The request, message artifact, authority, or response contract was invalid |
| `publication_verification_failed` | source event, role, attempt, failure time | A candidate's permit or publication evidence could not be verified |

No new global event is added. The interaction SQLite inbox and outbox own the state. A future global telemetry event must separately define retention and allowlisted fields.

## Consequences

Every accepted responding interaction either queues its intended reply, remains within an explicit retry budget, or queues a visible terminal explanation. A successful generation artifact alone is not a reply; a terminal failure reply alone is not proof of delivery.

## References

- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Conversation deployment composition](../../../architecture/system/conversation-routing/deployment-composition.md)
