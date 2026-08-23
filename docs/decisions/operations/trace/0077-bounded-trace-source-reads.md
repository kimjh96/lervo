# ADR-0077: Bounded trace source reads that expose truncation

Status: `accepted`
Decision date: 2026-08-20

## Decision

- Add `latest()` using `seq DESC LIMIT 1`; `last` selection no longer treats the default 100-row list as global head.
- Verify full integrity by streaming ordered SQLite rows, checking sequence, predecessor, and canonical hash without an all-event array.
- Complete `TraceReport` supports at most 1,000 events per run. After reading exactly 1,000, probe one more; if present fail `trace_result_too_large` rather than return a truncated “complete” report.
- Cursor pages are a separate contract in ADR-0078. Reads mutate nothing.

## Consequences

Large history neither silently changes latest-run selection nor grows integrity-check memory; oversized full runs fail explicitly.
