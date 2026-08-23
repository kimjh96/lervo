# ADR-0080: Shared diagnostics-report compatibility boundary

- Status: `accepted`
- Decision date: 2026-08-20

## Decision

`report-compatibility` owns the common validation order: supported integer version, registered JSON Schema, injected semantic validator, then a fixed source-free unsupported or invalid error.

Report-specific error classes, codes, and semantics remain in their contract modules. Common code knows nothing about doctor, trace, scope, or cursor concepts.

Split the trace CLI into `trace-options`, `trace-format`, and `trace-command`. Options make full, first-page, and cursor modes mutually exclusive. The command owns storage and application composition. The formatter renders only validated reports.

## Consequences

New reports reuse consistent fail-closed compatibility while retaining independent semantics and separated CLI responsibilities.
