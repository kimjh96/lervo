# ADR-0080: Shared diagnostics-report compatibility boundary

Status: `accepted`
Decision date: 2026-08-20

## Decision

`report-compatibility` owns the common order: supported integer version → registered JSON Schema → injected semantic validator → fixed source-free unsupported/invalid error.

Report-specific error classes/codes/semantics remain in their contract modules; common code knows no doctor/trace/scope/cursor concepts.

Split trace CLI into `trace-options`, `trace-format`, and `trace-command`. Options make full/first-page/cursor mutually exclusive; command owns storage/application composition; formatter renders only validated reports.

## Consequences

New reports reuse consistent fail-closed compatibility while retaining independent semantics and separated CLI concerns.
