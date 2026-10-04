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

## Re-queue of stalled jobs

Every worker run, CLI or Node and legacy or v4, first calls `requeueIntakeStalledRepositoryKnowledgeJobs`. It re-queues once each change whose latest resolution is `attention_required` with `review_source_limit_exceeded`, `repository_change_path_limit_exceeded`, or `asset_verification_required`. The original change event is enqueued under the separate `knowledge:repository:intake-requeue` destination, which the worker drains after new jobs. Its resolution has a distinct deterministic event ID and `supersedesResolutionEventId`. A change with a superseding resolution is never re-queued again, and historical resolutions are never rewritten.

The scan position lives in `.lervo/state/knowledge/intake-requeue-cursor.json`, a rebuildable projection bound to an event sequence and hash. Losing the file, or renumbering the store, only repeats an idempotent scan. Re-queued and new jobs share the 1,024-job outstanding ceiling. A full queue defers the remainder and leaves the cursor in place.

Jobs settled as `review_needs_attention` by the v4 runtime's placeholder reviewer are not re-queued here. ADR-0457 re-queues them once, together with replacing that reviewer.
