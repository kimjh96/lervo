# ADR-0077: Bounded trace source reads that expose truncation

Status: `accepted`
Decision date: 2026-08-20

## Decision

- Add `latest()` using `seq DESC LIMIT 1`; `last` selection no longer treats the default 100-row list as the global head.
- Verify full integrity by streaming ordered SQLite rows and checking sequence, predecessor, and canonical hash without building an all-event array.
- A complete `TraceReport` supports at most 1,000 events per run. After reading exactly 1,000 events, probe one more; if one exists, fail with `trace_result_too_large` instead of returning a truncated “complete” report.
- Cursor pages use the separate contract in ADR-0078.
- Reads mutate nothing.

## Consequences

Large histories neither silently alter latest-run selection nor increase integrity-check memory with total event count. Oversized full runs fail explicitly.
