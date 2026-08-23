# ADR-0084: 0.1.0 bounded trace default

Status: `accepted`
Decision date: 2026-08-20

## Decision

- From 0.1.0, `lervo trace [last|run-id]` defaults to the first page with `defaultTracePageSize=50`. Text and JSON output use `TracePageReport` v1 and emit no deprecation.
- Page, filter, and cursor behavior retains its existing snapshot semantics.
- Full aggregation requires `--full` and retains `TraceReport` v1, the 1,000-event cap, and `trace_result_too_large`; option exclusivity is unchanged.
- Capabilities v1 reports `defaultMode=page`, one implicit page mode, explicit full and cursor modes, and no deprecations. The reader retains the legacy `implicit_full` value for historical reports, but the current producer and request do not use it.
- Raise the root and all 55 private workspace packages to 0.1.0 together. Brand and package checks reject partial versioning. Keep historical ADRs and fixtures accurate, and document migration separately.
- Add no event, state, or privacy field.

## Consequences

Default trace memory and output are bounded, while whole-run dependency is explicit and legacy readers and source events remain valid.
