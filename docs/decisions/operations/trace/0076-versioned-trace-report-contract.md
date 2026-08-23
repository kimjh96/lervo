# ADR-0076: Versioned trace-report compatibility contract

Status: `accepted`
Decision date: 2026-08-20

## Decision

Define Draft 2020-12 `traceReportSchema` and derived `TraceReport` with required `schemaVersion: 1`. Reader validates event schema/hash/allowlist, one project/run, increasing global sequence, verifiable predecessor links, status/time/session aggregates, and integrity-snapshot coordinates.

The integrity snapshot means producer ran full project `verifyIntegrity`; a run-only report cannot reconstruct omitted interleaved runs. Compare head hash directly only when the returned last event is global head.

Allow optional report/integrity additions, while `EventEnvelope` keeps its strict own version. Removal/new required fields/type or controlled-status changes require a new version. Unsupported integer version is `trace_report_schema_unsupported`; invalid structure/semantics is `trace_report_invalid`. Errors echo no report source, payload, IDs, paths, or credentials. Validation is read-only.

## Consequences

Producers and consumers share one trace meaning without overstating a run slice as full-chain proof.
