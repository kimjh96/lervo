# ADR-0084: 0.1.0 bounded trace default

Status: `accepted`
Decision date: 2026-08-20

## Decision

- From 0.1.0, `lervo trace [last|run-id]` defaults to first page with `defaultTracePageSize=50`; text/JSON are `TracePageReport` v1 and emit no deprecation.
- Page/filter/cursor retain existing snapshot semantics.
- Full aggregation requires `--full`, retaining `TraceReport` v1, 1,000-event cap, and `trace_result_too_large`; option exclusivity is unchanged.
- Capability v1 reports `defaultMode=page`, one implicit page mode, explicit full/cursor, and no deprecations. Reader retains legacy `implicit_full` value for historical reports but current producer/request does not.
- Raise root and all 55 private workspace packages together to 0.1.0; brand/package checks reject partial versioning. Keep historical ADR/fixtures accurate and document migration separately.
- Add no event/state/privacy field.

## Consequences

Default trace memory/output is bounded, while whole-run dependency is explicit and legacy readers/source events remain valid.
