# Per-change knowledge intake

Status: `active`
As of: 2026-10-05

[ADR-0457](../../../decisions/knowledge/documents/0457-degrade-knowledge-intake-per-file-and-consolidate-documents.md) replaces whole-job rejection of per-change knowledge jobs with per-file degradation. This contract covers the `knowledge:repository` job from `repository.change.completed` to `repository.knowledge.resolved`.

## One intake policy

`packages/repository-knowledge/src/knowledge-intake-policy.ts` owns inclusion for the scanner, the change source, and the change review. Node repository-work observation reuses its Lervo projection prefixes.

- The scanner excludes `.lervo/knowledge/policy.yaml` `exclude` patterns and transient tool caches, as before.
- A change review treats these as `generated`: the policy's `exclude` patterns, `.lervo/generated/**`, `.lervo/state/**`, `.lervo/data/**`, `docs/knowledge/**`, `.changes/**`, `release-*.json`, `release-sbom*.json`, `*.lock`, and `pnpm-lock.yaml`, each at any depth. Projects extend the set through `exclude`.
- A missing policy file uses the defaults. An unreadable or invalid file fails closed, because a fallback would widen what reaches a reviewer.

The planner still drops Git-ignored untracked paths. Source manifest schema version 4 keeps every other changed path and records `disposition: reviewable | generated`, so excluded paths stay counted. A unit in which every change is generated produces no job.

## Per-file degradation

Before review, each manifest path receives one outcome:

| Disposition         | Condition                                                                             |
| ------------------- | ------------------------------------------------------------------------------------- |
| reviewed            | Exact UTF-8 text on both sides, with before and after bytes totalling at most 256 KiB |
| `skipped_generated` | The manifest or the intake policy marks the path generated; its bytes are not read    |
| `skipped_oversize`  | The before and after bytes together exceed 256 KiB                                    |
| `skipped_binary`    | Either side is not UTF-8 text or contains NUL                                         |

An oversize or binary path still proves currency by its digest, so a change during review makes the whole unit `stale`. Generated paths are outside the fence.

Reviewable paths form ordered sub-jobs of at most 64 paths and 256 KiB of review bytes. A single file always fits one sub-job. The sub-jobs share one completion and settle in one `repository.knowledge.resolved` event. The first sub-job that is not `implementation_only` decides the outcome: `canonical_change_candidate` registers one canonicalization candidate over every reviewed path, and `needs_review` settles `review_needs_attention`. `current` requires every reviewable path reviewed as `implementation_only`, reconstructable former bytes, and a current knowledge lifecycle. A unit whose only changes are generated settles from the lifecycle check alone.

`repository_change_path_limit_exceeded`, `review_source_limit_exceeded`, and `asset_verification_required` are no longer emitted by this worker. Opaque assets remain owned by baseline asset verification.

## Resolution fields

`repository.knowledge.resolved` gains additive optional fields. Earlier events stay valid without them.

| Field                         | Meaning                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `skippedPathCount`            | Paths skipped as generated, oversize, or binary                                          |
| `skippedReasons`              | Sorted unique subset of `skipped_binary`, `skipped_generated`, `skipped_oversize`        |
| `subJobIndex`                 | Zero-based sub-job whose review decided a non-current outcome, or null                   |
| `subJobCount`                 | Reviewed sub-jobs; zero when nothing was reviewable                                      |
| `supersedesResolutionEventId` | Present only on a re-queued resolution; names the original resolution of the same change |

Privacy: the fields carry counts, fixed reason codes, and an event ID. They exclude paths, source bytes, and provider output.

New failure code `review_sources_unreviewable` (`attention_required`): every changed path was oversize or binary, so nothing could support a currency claim. Retry cannot change it; a later change or baseline convergence must cover those paths.

## The v4 per-change reviewer

The v4 runtime no longer settles change jobs through a placeholder. `packages/repository-knowledge-runtime/src/change-review-host.ts` runs the shared no-capability review adapter from `@lervo/repository-knowledge-compiler` under v4 governance. The adapter owns the prompt, the response schema, the provider process, and usage normalization. The runtime owns authority, admission, budget, and measurement, and never sees provider-native output.

Each sub-job review call goes through these steps:

1. Authority: an active, unexpired convergence delegation for the project that lists the provider. Without one, the job settles `attention_required` with `knowledge_authority_unavailable` and no provider call is made.
2. Admission: the shared host provider admission, at most two background calls per host with live work first. Busy capacity is transient and retried with the worker's bounded backoff.
3. Budget: one call reservation in the convergence budget, scoped to the change event and its queue destination. A job may make at most the delegation's `maximumProviderCalls` calls across all sub-jobs and retries. One more settles `knowledge_review_budget_exhausted`. The reservation is released once the job's resolution event exists.
4. Measurement: one `resource.usage.recorded` per call, including failed calls.
5. Provider availability: a quota or authentication failure pauses the provider in admission and settles the job `knowledge_provider_paused`. Usage that is missing or invalid settles `knowledge_usage_unavailable`.

Before claiming change jobs, a v4 worker run checks for live foreground work and for a paused provider. Either one leaves the jobs queued, so a quota window or an active session does not spend their attempts.

### Usage attribution

The usage event uses `scope: primary_provider`, `source: provider_reported`, and the adapter's `operation_delta` accounting descriptor, stored in CAS. It carries these ADR-0459 attribution fields. They are optional on the schema, so older events stay valid.

| Field                | Value for a per-change review                            |
| -------------------- | -------------------------------------------------------- |
| `channel`            | `knowledge_worker`                                       |
| `turnEventId`        | The `repository.change.completed` event ID               |
| `conversationDigest` | null                                                     |
| `stage`              | `repository_change_review`                               |
| `workId`             | Deterministic from the change event, shared by its calls |

The event ID is deterministic from the change event, the queue destination, and the call ordinal, so a replay cannot double count. Privacy: counts, identifiers, and hashes only, never prompts, source text, or provider output. Failure meaning: `status: unavailable` with `knowledge_provider_call_failed` or `knowledge_usage_unavailable` means the call was made but its spend is unproven. It is never reported as zero usage.

New attention codes on `repository.knowledge.resolved`: `knowledge_authority_unavailable`, `knowledge_review_budget_exhausted`, `knowledge_provider_paused`, and `knowledge_usage_unavailable`. Each is non-retryable for that job. A later re-queue or a baseline convergence must cover the change.

## Re-queue of stalled jobs

Every worker run, CLI or Node and legacy or v4, first calls `requeueStalledRepositoryKnowledgeJobs`. It re-queues each change once when its latest resolution is `attention_required` and either of these holds:

- The failure code is `review_source_limit_exceeded`, `repository_change_path_limit_exceeded`, or `asset_verification_required`, which whole-job intake rejection caused.
- The failure code is `review_needs_attention` and the resolution predates ADR-0457, because it lacks `subJobCount`. The v4 placeholder reviewer produced these.

The original change event is enqueued under the separate `knowledge:repository:requeue` destination, which the worker drains after new jobs. Its resolution has a distinct deterministic event ID and `supersedesResolutionEventId`, and its review budget starts fresh. A change with a superseding resolution is never re-queued again, and historical resolutions are never rewritten.

The scan position lives in `.lervo/state/knowledge/requeue-cursor.json`, a rebuildable projection bound to an event sequence and hash. Losing the file, or renumbering the store, only repeats an idempotent scan. Re-queued and new jobs share the 1,024-job outstanding ceiling. A full queue defers the remainder and leaves the cursor in place.
