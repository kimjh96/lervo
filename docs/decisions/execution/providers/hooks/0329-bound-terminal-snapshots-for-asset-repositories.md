# ADR-0329: Bound terminal snapshots for asset repositories

Date: 2026-09-01

## Context

The unmanaged terminal hook snapshots repository-authored bytes before context preparation and again at completion. Its former 256 MiB cumulative ceiling rejected repositories with legitimate source assets even when file-count, individual-read, and generated-state exclusion checks passed. `digimon` reproduced this without a Hub: knowledge migration and Lexical v2 were ready, but `UserPromptSubmit` and `terminal status` could not capture the repository snapshot.

Repository-specific directory names and request keywords are invalid selection rules. Excluding source assets would hide changes from completion evidence.

## Decision

- Retain exact per-file hashes, the file-count bound, safe-read checks, and a fail-closed cumulative byte bound.
- Raise the default cumulative byte ceiling to 1 GiB, keeping ordinary binary-asset repositories observable while preserving a bounded scan.
- Exclude the conventional generated `.cache` directory alongside existing dependency and build directories.
- Do not exclude user-owned asset directories or infer exclusions from repository names.
- Preserve repository-specific policy injection for managed callers with explicit, reviewed scope.

Event names and payloads remain unchanged. Exceeding either bounded ceiling still fails with `RepositorySnapshotError`. Successful snapshots retain the privacy-bounded path-to-content-hash projection and store no source bytes in events.

## Verification

Contract tests bind the 1 GiB default, conventional generated-directory exclusion, exact source hashing, change detection, and fail-closed caller-supplied limits. After installing the patched CLI, both the `digimon` terminal lifecycle and a real `UserPromptSubmit` hook invocation must complete.
