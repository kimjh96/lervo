# ADR-0079: Explicit trace-page event-type filters

Status: `accepted`
Decision date: 2026-08-20

## Decision

- Apply filters only to bounded pages, via repeatable unique allowlisted `--event-type`.
- Report sorted conditions and show them in text.
- Bind conditions into cursor/checksum; continuation uses cursor conditions and rejects new filter arguments.
- Verify every event matches and report/cursor conditions agree.
- Scan storage in batches up to 1,000, collecting only page limit plus one match.
- Existing run with no match is `trace_filter_empty`; absent run is `trace_run_not_found`.
- Filtering mutates nothing and claims no full-run status.

## Consequences

Conditions remain visible and stable across pages without confusing empty filters with absent runs.
