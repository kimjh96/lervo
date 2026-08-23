# ADR-0079: Explicit trace-page event-type filters

Status: `accepted`
Decision date: 2026-08-20

## Decision

- Apply filters only to bounded pages through repeatable, unique, allowlisted `--event-type` arguments.
- Sort reported conditions and display them in text output.
- Bind conditions into the cursor and checksum. Continuation uses the cursor's conditions and rejects new filter arguments.
- Verify that every event matches and that report and cursor conditions agree.
- Scan storage in batches of at most 1,000, collecting only the page limit plus one matching event.
- For an existing run with no match, fail with `trace_filter_empty`; for an absent run, fail with `trace_run_not_found`.
- Filtering mutates nothing and claims no full-run status.

## Consequences

Conditions remain visible and stable across pages, while empty filter results remain distinct from absent runs.
