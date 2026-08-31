# ADR-0329: Bound terminal snapshots for asset repositories

Date: 2026-09-01

## Context

The unmanaged terminal hook snapshots repository-authored bytes before preparing context and again at completion. The former 256 MiB cumulative ceiling rejected repositories containing legitimate source assets even when file count, individual reads, and all generated-state exclusions were valid. `digimon` reproduced the failure without a Hub: knowledge migration and Lexical v2 were ready, but `UserPromptSubmit` and `terminal status` could not capture the repository snapshot.

Repository-specific directory names or request keywords are not valid selection rules. Excluding source assets would also hide changes from completion evidence.

## Decision

- Keep the existing exact per-file hashes, file-count bound, safe-read checks, and fail-closed cumulative byte bound.
- Raise the default cumulative byte ceiling to 1 GiB so ordinary binary-asset repositories remain observable without making the scan unbounded.
- Exclude the conventional `.cache` generated directory alongside existing dependency and build directories. Do not exclude user-owned asset directories or infer exclusions from repository names.
- Preserve repository-specific policy injection for managed callers that have an explicit, reviewed scope.

No event name or payload changes. A repository exceeding either bounded ceiling still fails with `RepositorySnapshotError`; successful snapshots retain the same privacy-bounded path-to-content-hash projection and store no source bytes in events.

## Verification

Contract tests bind the 1 GiB default, conventional generated-directory exclusion, exact source hashing, change detection, and fail-closed caller-supplied limits. The `digimon` terminal lifecycle and a real `UserPromptSubmit` hook invocation must complete after the patched CLI is installed.
