# Conversation knowledge-job lease and source preflight

## Authority and lease checks

The local event chain is the job authority; the capacity-bounded destination outbox is its rebuildable queue. A background worker claims one `knowledge:conversation` row, then re-reads that exact event-and-destination row and the canonical event before inspecting sources and after any asynchronous source read.

The row must remain leased to the same worker with the same claim time, expiry, and attempt count, and observation must occur within the lease. A missing, expired, acknowledged, rescheduled, or reclaimed row yields `knowledge_job_lease_conflict` and grants no further work authority. Preflight neither renews the lease nor publishes an outcome. Each effect must revalidate the lease at its own boundary.

## Completion and source eligibility

Only version-3 `pending_background` repository-work completions and historical version-2 `baseline_valid` completions are eligible. Other events yield `knowledge_job_completion_invalid`.

For changed sources, load the exact content-addressed manifest and inspect current Git/worktree coordinates. Return `ready_for_review`, `stale`, or `needs_review` with bounded source reason codes. Historical completions return `needs_review/legacy_source_unavailable`; never invent an old manifest or claim currency. Missing or invalid manifests retain typed `knowledge_job_source_unavailable` or `knowledge_job_source_invalid` failures.

No preflight state proves semantic review, canonical edits, knowledge lint success, or delivery.

## Privacy and acknowledgement

Queue state contains only event and destination IDs, worker lease coordinates, attempt count, bounded failure code, and timestamps. Preflight returns source paths only within the owner process for later scoped agent review; it writes no event or user-owned file.

Public events and status exclude source bytes, prompts, provider output, absolute paths, credentials, and raw exceptions. Queue acknowledgement requires a separate canonical terminal outcome and the exact live lease. Successful preflight is never acknowledged as completed work.

## Agent identity and assignment authority

The resolution event's `agentId` identifies the separately assigned background knowledge agent, which need not be the live conversation worker in the completion. Reconciliation matches the completion event/hash, source event, deterministic job ID, and source-manifest coordinate; it must not equate these agent identities.

The outcome writer must prove its own active agent and exact assignment lease before append and acknowledgement. A matching completion coordinate alone does not authorize a worker outcome.

## Read-only semantic review

Before provider work and after its response, the reviewer checks exact knowledge-job assignment provenance, named active agent, role and capability binding, source-path set, verification suites, and unexpired assignment lease.

Review uses the provider-neutral no-capability JSON runner in a separate private temporary directory, with no model tools or retained session. Exact before/after source bytes and content-hash-matched canonical context pass only through process stdin, up to 256 KiB. Binary source and oversized input fail without truncation.

- Changed source yields `stale/source_bytes_changed`.
- Changed instruction bytes yield `needs_review/review_context_stale`.
- Missing required context yields `needs_review/review_context_unavailable`.
- Over-bound required context yields `needs_review/review_context_limit_exceeded`.
- Invalid context, provider boundary or response, and absent usage retain typed non-success failures.

A valid model result is only a private semantic candidate: `implementation_only`, `canonical_change_candidate`, or `needs_review`. It is never an event, write grant, queue acknowledgement, or `current` claim. Later writing requires its own narrow assignment, integration, and canonical knowledge outcome.

## Dormant non-success outcome writer

The writer accepts a version-3 content-bound completion or historical version-2 `baseline_valid` completion, its exact live outbox lease, and an active source-scoped read-only knowledge assignment for the separate background agent.

For version 3, reload the CAS manifest and current source coordinates before writing. `stale/source_bytes_changed` requires observed source drift; a source-currency failure cannot be asserted against a ready source.

For historical version 2, allow only `attention_required/legacy_source_unavailable` or a legitimately exhausted retry. The outcome carries `legacy_unavailable`, never an invented source hash or stale/current claim.

Within one event-store transaction, recheck the queue lease, append at most one deterministic `conversation.repository_knowledge.resolved` event, and acknowledge that same lease. Schema or append failure rolls back acknowledgement.

The event contains only bounded IDs, hashes, state, attempt count, and failure code; it excludes source bytes and raw provider failure.

- `knowledge_resolution_invalid`: the proposed non-success state or bounded failure code contradicts observed source/attempt state.
- `knowledge_resolution_conflict`: the canonical completion, attempt, or existing resolution changed.

Neither code claims success. This writer cannot produce `current`, which requires reviewed canonicalization, ordered migration/refresh/lint, and a separate verified producer.

## Retry ceiling and recovery

The logical retry budget is 16 work attempts. A crash or lease expiry at the ceiling may require another queue claim solely to recover and record `attention_required/knowledge_retry_exhausted`; this recovery claim authorizes no further semantic work attempt.

The event's bounded `attemptCount` remains 16 even if the operational outbox lease count is greater. `knowledge_retry_exhausted` is invalid before the ceiling. If the source has become stale, record `stale/source_bytes_changed` from observed evidence instead.

This recovery prevents an expired sixteenth lease from leaving a permanently pending job without falsifying knowledge currency.
