# ADR-0076: Versioned Trace-Report Compatibility Contract

- Status: `accepted`
- Decision date: 2026-08-20

## Decision

Define Draft 2020-12 `traceReportSchema` and derived `TraceReport`, requiring `schemaVersion: 1`. The reader validates the event schema, hashes, allowlist, single project and run, increasing global sequence, verifiable predecessor links, status, time and session aggregates, and integrity-snapshot coordinates.

An integrity snapshot means the producer ran full-project `verifyIntegrity`; a run-only report cannot reconstruct omitted interleaved runs. Compare the head hash directly only when the last returned event is the global head.

Optional report and integrity fields may be added, while `EventEnvelope` retains its own strict version. Removing fields, adding required fields, changing types, or changing controlled statuses requires a new version.

An unsupported integer version returns `trace_report_schema_unsupported`; invalid structure or semantics returns `trace_report_invalid`. Errors echo no report source, payload, IDs, paths, or credentials. Validation is read-only.

## Consequences

Producers and consumers share one trace meaning without overstating a run slice as full-chain proof.
