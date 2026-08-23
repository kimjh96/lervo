# ADR-0078: Snapshot-bound local trace cursor pages

Status: `accepted`
Decision date: 2026-08-20

## Decision

Define a separate `TracePageReport` v1 containing the project and run, full-store integrity snapshot, page coordinates, and at most 100 events. It never reports whole-run status.

The first page uses `--page-size 1..100`; continuation uses the returned cursor. Through canonical JSON and a SHA-256 checksum, the cursor binds its version, project and run, global event count and head hash, last sequence and event hash, and page size. The checksum detects corruption, not authority.

Continuation reruns integrity verification and requires the same count and head; otherwise it fails with `trace_cursor_stale`. Invalid format, checksum, coordinates, or absence of a next event fails with `trace_cursor_invalid`. The reader revalidates events, ordering and linkage, counts, `hasMore`, and the cursor. Unsupported versions are never guessed. Reads mutate nothing.

## Consequences

Large runs are pageable without mixing appends across a single logical snapshot.
