# ADR-0283: Prepare a deterministic linked-context canary v4

Status: `accepted`
Date: 2026-08-29

## Context

[ADR-0282](0282-remove-api-key-requirement-from-managed-context-canary.md) removed API keys from the primary experiment design by projecting passed V18 selections onto the current additional linked-candidate set. Provider-free preparation passed every evidence binding but retained no added source for Codex and only one source in one Claude run. [V3](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v3.md) was rejected before execution because its population could not measure a comparable context effect.

The current managed projection remains bounded and exact. Each scheduled run has two to six one-hop registered linked candidates, all tied to the reviewed canary's source snapshot, recommendation batch, content hash, byte ceiling, and task coordinates. Selecting the complete bounded projection is a provider-neutral policy decision that requires no model turn.

## Decision

Prepare `linked-evidence-managed-canary-v4-deterministic-20260829` over the same eight paired source tasks. Select every current managed linked candidate in deterministic projection order, with no more than eight sources or 117,813 source bytes per run. Require at least one exact selection in every run. Before a task adapter can be created, reject any empty, stale, reordered, duplicated, excessive, hash-mismatched, or source-drifted projection.

V4 makes zero selection calls and has a 16-call ceiling: eight ordinary read-only Codex task calls and eight ordinary read-only Claude task calls. Both arms use existing provider-native signed-in sessions. No public or prepared field contains an API credential or selection transport. The optional Responses BYOK boundary remains outside the primary path.

Keep V1 terminal, V2 unexecuted, and V3 rejected. Do not resume, retry, repair, or replace them. Preparation is provider-free and retains the prohibitions on retries, fallback, writes, external messages, Hub effects, direct-terminal effects, operational-search changes, and production traffic.

Deterministic policy selection is current E1 evidence. Exact reload, adapter-confirmed delivery, and final references remain separate E2, E3, and E4 evidence. Selecting all bounded candidates does not prove relevance, provider attention, semantic use, answer quality, or savings.

The owner-only v4 manifest remains non-executable until exact operator authority binds its final digest and source/build snapshot. Neither this decision nor preparation authorizes a provider call.

## Consequences

Every paired run now has a real, comparable managed linked-context effect without a user API key or duplicate selection call. The prepared 16-call ceiling is half of v1/v2's 32 calls. This is only a call-budget reduction; task speed, accuracy, reference precision, provider-reported tokens, and cost remain unmeasured until all 16 task runs complete and pass review.

Selecting all candidates trades selection precision for a clean context-effect test. The unchanged final-reference precision and answer-quality gates determine whether the additional context is useful enough to advance. Failure rejects v4 without changing production search.

## Verification

- Reconstruct the exact 16-run schedule and prove every run selects all two to six current linked candidates in deterministic order with exact hashes.
- Prove zero selection calls, zero selection-input bytes, a 16-task-call ceiling, no credential or selection-transport field, provider-free preparation, exact replay, and mode `0600`.
- Preserve v1-v3 exact records and reject source or projection drift before task adapter creation.
- Run focused checkpoint tests, repository quality and full checks, documentation lifecycle, knowledge migration and lint, and exact-base release completion.

## References

- [V3 rejection evidence](../../../../evidence/search/provider-shadow/linked-evidence-managed-canary-v3.md)
- [API-key-free primary path](0282-remove-api-key-requirement-from-managed-context-canary.md)
- [Managed canary design](0277-stage-managed-context-relational-canary.md)
- [Measurement report](../../../../evidence/search/codex-claude-linked-evidence-measurement-report.md)
