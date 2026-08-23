# ADR-0081: Trace default-output transition contract

Status: `accepted`; ADR-0084 completed the 0.1.0 transition
Decision date: 2026-08-20

## Decision

During 0.0.x, distinguish implicit full mode while preserving v1 stdout/exit behavior and emit once on stderr `trace_implicit_full_deprecated` with fixed source-free guidance. Explicit `--full` has no warning and is mutually exclusive with page/filter/cursor options before storage opens.

Reserve bounded page default for 0.1.0, requiring in one release: default page size 50, retained `--full`, updated help/capabilities/migration docs, and split fixtures. Do not activate from this ADR alone.

## Consequences

Existing automation could pin `--full`; ADR-0084 later made the coordinated transition.
