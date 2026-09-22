# ADR-0387: Terminal outcomes for conversation response failures

- Status: accepted
- Decision date: 2026-09-08

## Context

A Discord question reached intent resolution and produced a valid Codex response artifact, but publication writing repeatedly failed. The interaction runtime collapsed the responder error into `response_generation_failed`, retried without an attempt bound, and showed no terminal outcome. Later messages could complete while the original request remained silently active.

A second silence path preceded response execution: an unaddressed human message in a dedicated mapped channel asked the same managed turn to decide semantic participation. If that provider call failed, the runtime recorded `relevance_unavailable` as an observed decision without entering bounded response failure handling.

## Decision

The responder boundary preserves provider-neutral failure classifications. The installed Node distinguishes unknown generation, unconfirmed effects, repository-context, provider, provider capacity, evidence-storage, writing evaluation, writing policy, execution-contract, response-contract, and publication-verification failures. Durable codes are `response_generation_failed`, `response_effect_unconfirmed`, `response_context_unavailable`, `response_provider_unavailable`, `response_provider_capacity`, `response_storage_unavailable`, `response_evaluation_unavailable`, `response_writing_blocked`, `response_execution_invalid`, `response_contract_invalid`, and `publication_verification_failed`. Provider-specific error prose and payloads do not cross that boundary.

An unavailable or invalid semantic evaluator differs from a completed evaluation rejecting content. Evaluator unavailability retains the generated response artifact for bounded retry: a Claude evaluation failure does not rerun the Codex response. A completed rejection removes the candidate and permits one bounded regeneration attempt.

Each deployment sets `policy.maxResponseAttempts` from 1 through 10, defaulting to 3. Only failures with a proven transient disposition, such as response-artifact storage failure, writing-evaluator unavailability, provider startup or read-only turn failure, or provider-reported capacity exhaustion, are rescheduled while the current claim attempt is below the bound. Capacity retries use a bounded exponential delay with source-event-derived jitter; other retries use the configured delay. Repository-context, provider protocol/stream, contract, telemetry, and unknown failures remain terminal instead of repeating ambiguous work. Native repository-work effects are not replayed by this read-only conversation policy. A non-retryable failure or exhausted retry budget creates one fixed multilingual status artifact, verifies it through a deterministic no-model writing contract, records a normal durable outbox message, and completes the inbox as `failed_terminal`. The static response names only the safe failure category and attempt count; it excludes source event, run, workstream, and revision IDs, prompt text, provider errors, credentials, model output, and unrestricted artifact locations.

Supervision admission is an exception only because exact source binding and standing-successor preparation are idempotent and restart-recoverable. An unclassified admission error maps to retryable `response_effect_unconfirmed`; the same source may re-enter admission within the existing attempt bound without rerunning the managed classification or creating another successor. Repository work never receives that retry permission. An interrupted repository-work turn first reconciles an exact verified canonical completion into its local projection without rerunning the provider. A missing or conflicting completion remains nonretryable `response_effect_unconfirmed`; it is not mislabeled as generic response generation failure. If reconciliation exhausts or a post-effect repository completion gate remains unresolved, the fixed response says the effect state is unconfirmed and directs the requester not to send the same operation again before inspection.

`policy.unaddressedHumanMessages` independently controls whether unaddressed human messages require semantic participation evaluation:

- `evaluate` preserves selective shared-channel behavior.
- `respond` assigns every eligible unaddressed human message to the deterministic turn owner with reason `owned_human_message`, without claiming semantic relevance.

Discord natural-language routing defaults to `respond`; deployments without routing default to `evaluate`. Mention-only, silent, actor, automation-depth, cooldown, hourly-rate, and turn-ownership checks still take precedence.

The owned responder performs the managed turn. Provider or structured-output failures enter the same classified, bounded response retry and visible terminal-failure path as other response failures. Unaddressed agent messages still require semantic relevance so the human guarantee cannot create agent reply loops.

The durable inbox retains the terminal failure code, failure time, and attempt count alongside its completed state. `failed_terminal` means response generation or publication did not complete and a verified explanatory message was queued; it does not prove platform delivery. The ordinary outbox delivery receipt separately proves delivery. Failure to store or verify the fixed terminal response is an interaction runtime failure, not another unbounded generation retry.

Retry selection uses availability time and bounded batches. Rescheduling places failed items behind ready newer work; exhaustion prevents a permanently poisoned item from consuming future cycles.

## State and failure meaning

| State or code                     | Required fields                                                                         | Meaning                                                                                                                                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retry_scheduled`                 | source event, role, failure code, attempt, next attempt time                            | Another bounded attempt may run; no reply has been queued                                                                                                                                                     |
| `failed_terminal`                 | source event, role, failure code, attempt count, fixed verified outbound                | Generation or publication ended and an explanatory reply was queued                                                                                                                                           |
| `response_effect_unconfirmed`     | source event, role, attempt, failure time                                               | An idempotent supervision admission is being reconciled, or repository work lacks one exact matching verified canonical completion; the code contains no effect payload and does not prove success or absence |
| `owned_human_message`             | source event, policy, role, deterministic owner, `relevance=not_checked`, decision time | An eligible unaddressed human message must enter response handling without a semantic relevance claim                                                                                                         |
| `response_context_unavailable`    | source event, role, attempt, failure time                                               | Repository snapshot, knowledge, selected context, or context injection could not be completed                                                                                                                 |
| `response_provider_unavailable`   | source event, role, attempt, failure time                                               | The provider process, protocol, stream, turn, or result could not be completed                                                                                                                                |
| `response_provider_capacity`      | source event, role, attempt, failure time; next attempt time when rescheduled           | The provider explicitly reported temporary model capacity exhaustion; no model output is claimed                                                                                                              |
| `response_storage_unavailable`    | source event, role, attempt, failure time                                               | Required response artifact or telemetry evidence could not be committed                                                                                                                                       |
| `response_writing_blocked`        | source event, role, attempt, failure time                                               | Generated content did not pass its writing contract                                                                                                                                                           |
| `response_evaluation_unavailable` | source event, role, attempt, failure time                                               | The independent writing evaluator failed or returned an invalid contract; the generated artifact remains cached for retry                                                                                     |
| `response_execution_invalid`      | source event, role, attempt, failure time                                               | Managed execution evidence or independent session binding was invalid                                                                                                                                         |
| `response_contract_invalid`       | source event, role, attempt, failure time                                               | The request, message artifact, authority, or response contract was invalid                                                                                                                                    |
| `publication_verification_failed` | source event, role, attempt, failure time                                               | A candidate's permit or publication evidence could not be verified                                                                                                                                            |

No new global event is added. The existing `provider.turn.failed` event may carry `failureCode=provider_capacity_unavailable` when a provider's machine-readable overload code or structured upstream HTTP 503 reports temporary capacity loss. HTTP 429 and untyped failure prose do not imply this code. Its required `providerTurnId`, `failureCode`, and `diagnosticDigest` follow the existing private adapter-event retention; the digest, never the provider message or prompt, is recorded. This code means that turn failed for explicitly reported temporary capacity, not that the model was invalid or that repository work is safe to replay. The interaction SQLite inbox and outbox own the response state. A future global telemetry event must separately define retention and allowlisted fields.

The new policy value and decision reason contain no message text, provider payload, credential, or model output. They inherit the existing bounded participation-decision retention and privacy contract.

## Consequences

Every accepted responding interaction either queues its intended reply, remains within an explicit retry budget, or queues a visible terminal explanation. A successful generation artifact alone is not a reply; a terminal failure reply alone is not proof of delivery.

## References

- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Conversation deployment composition](../../../architecture/system/conversation-routing/deployment-composition.md)
