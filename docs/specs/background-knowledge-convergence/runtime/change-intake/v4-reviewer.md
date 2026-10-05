# The v4 per-change reviewer

The v4 runtime no longer settles change jobs through a placeholder. `packages/repository-knowledge-runtime/src/change-review-host.ts` runs the shared no-capability review adapter from `@lervo/repository-knowledge-compiler` under v4 governance.

The adapter owns the prompt, response schema, provider process, and usage normalization. The runtime owns authority, admission, budget, and measurement, and never sees provider-native output.

## Review governance

Each sub-job review call follows these steps:

1. Authority requires an active, unexpired convergence delegation for the project that lists the provider. Without it, the job settles `attention_required` with `knowledge_authority_unavailable`; no provider call is made.
2. Shared host provider admission allows at most two background calls per host, with live work first. Busy capacity is transient and retried with the worker's bounded backoff.
3. Budget requires one call reservation in the convergence budget, scoped to the change event and its queue destination. Across all sub-jobs and retries, a job may make at most the delegation's `maximumProviderCalls` calls. One more settles `knowledge_review_budget_exhausted`. The reservation is released once the job's resolution event exists.
4. Measurement emits one `resource.usage.recorded` per call, including failed calls.
5. A quota or authentication failure pauses the provider in admission and settles the job `knowledge_provider_paused`. Missing or invalid usage settles `knowledge_usage_unavailable`.

Before claiming change jobs, each v4 worker run checks for live foreground work and a paused provider. Either condition leaves jobs queued, so a quota window or active session does not spend their attempts.

## Usage attribution

The usage event uses `scope: primary_provider`, `source: provider_reported`, and the adapter's `operation_delta` accounting descriptor, stored in CAS. Its ADR-0459 attribution fields are optional in the schema, preserving validity of older events.

| Field | Per-change review value |
| --- | --- |
| `channel` | `knowledge_worker` |
| `turnEventId` | The `repository.change.completed` event ID |
| `conversationDigest` | null |
| `stage` | `repository_change_review` |
| `workId` | Deterministic from the change event and shared by its calls |

The usage event ID is deterministic from the change event, queue destination, and call ordinal, preventing replay double counting. Events contain only counts, identifiers, and hashes; never prompts, source text, or provider output.

`status: unavailable` with `knowledge_provider_call_failed` or `knowledge_usage_unavailable` means a call was made but its spend is unproven. It is never reported as zero usage.

New attention codes on `repository.knowledge.resolved` are `knowledge_authority_unavailable`, `knowledge_review_budget_exhausted`, `knowledge_provider_paused`, and `knowledge_usage_unavailable`. Each is non-retryable for that job. A later re-queue or baseline convergence must cover the change.
