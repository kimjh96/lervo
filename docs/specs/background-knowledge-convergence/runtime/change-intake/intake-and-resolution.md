# Intake and resolution

## One intake policy

`packages/repository-knowledge/src/knowledge-intake-policy.ts` owns inclusion for the scanner, change source, and change review. Node repository-work observation reuses its Lervo projection prefixes.

- The scanner excludes `.lervo/knowledge/policy.yaml` `exclude` patterns and transient tool caches.
- Change review treats the policy's `exclude` patterns, `.lervo/generated/**`, `.lervo/state/**`, `.lervo/data/**`, `docs/knowledge/**`, `.changes/**`, `release-*.json`, `release-sbom*.json`, `*.lock`, and `pnpm-lock.yaml` as `generated`, each at any depth. Projects extend this set through `exclude`.
- A missing policy file uses defaults. An unreadable or invalid file fails closed: fallback would widen what reaches a reviewer.

The planner drops Git-ignored untracked paths. Source manifest schema version 4 keeps every other changed path with `disposition: reviewable | generated`, so excluded paths remain counted. An all-generated unit produces no job.

## Per-file degradation

Before review, each manifest path receives one outcome:

| Outcome | Condition |
| --- | --- |
| `reviewed` | Exact UTF-8 text on both sides; combined before and after bytes total at most 256 KiB |
| `skipped_generated` | Manifest or intake policy marks the path generated; bytes are not read |
| `skipped_oversize` | Combined before and after bytes exceed 256 KiB |
| `skipped_binary` | Either side is not UTF-8 text or contains NUL |

Oversize and binary paths still prove currency by digest: a change during review makes the whole unit `stale`. Generated paths are outside this fence.

Reviewable paths form ordered sub-jobs of at most 64 paths and 256 KiB of review bytes. A single file always fits one sub-job. All sub-jobs share one completion and settle in one `repository.knowledge.resolved` event.

The first sub-job that is not `implementation_only` decides the outcome:

- `canonical_change_candidate` registers one canonicalization candidate over every reviewed path.
- `needs_review` settles `review_needs_attention`.

`current` requires every reviewable path to be reviewed as `implementation_only`, reconstructable former bytes, and a current knowledge lifecycle. A unit with only generated changes settles from the lifecycle check alone.

This worker no longer emits `repository_change_path_limit_exceeded`, `review_source_limit_exceeded`, or `asset_verification_required`. Baseline asset verification still owns opaque assets.

## Resolution fields

`repository.knowledge.resolved` adds optional fields; earlier events remain valid without them.

| Field | Meaning |
| --- | --- |
| `skippedPathCount` | Paths skipped as generated, oversize, or binary |
| `skippedReasons` | Sorted unique subset of `skipped_binary`, `skipped_generated`, `skipped_oversize` |
| `subJobIndex` | Zero-based sub-job whose review decided a non-current outcome, or null |
| `subJobCount` | Reviewed sub-jobs; zero when nothing was reviewable |
| `supersedesResolutionEventId` | Present only on a re-queued resolution; identifies the original resolution of the same change |

These fields carry counts, fixed reason codes, and an event ID. They exclude paths, source bytes, and provider output.

`review_sources_unreviewable` is a new `attention_required` failure: every changed path was oversize or binary, leaving nothing to support a currency claim. Retry cannot change this; a later change or baseline convergence must cover those paths.
