# ADR-0078: Snapshot-bound local trace cursor pages

Status: `accepted`
Decision date: 2026-08-20

## Decision

Define separate `TracePageReport` v1 containing project/run, full-store integrity snapshot, page coordinates, and at most 100 events—never whole-run status.

First page uses `--page-size 1..100`; continuation uses returned cursor. Cursor content-binds version, project/run, global event count/head hash, last sequence/event hash, and page size through canonical JSON plus SHA-256 checksum. Checksum detects corruption, not authority.

Continuation reruns integrity and requires the same count/head, otherwise `trace_cursor_stale`. Invalid format/checksum/coordinates/no next event is `trace_cursor_invalid`. Reader revalidates events, ordering/linkage, counts, `hasMore`, and cursor. Unsupported versions are never guessed. Reads mutate nothing.

## Consequences

Large runs are pageable without mixing appends across one logical snapshot.
