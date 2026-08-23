# ADR-0081: Trace default-output transition contract

Status: `accepted`; ADR-0084 completed the 0.1.0 transition
Decision date: 2026-08-20

## Decision

During 0.0.x, distinguish implicit full mode while preserving v1 stdout and exit behavior. Emit `trace_implicit_full_deprecated` once on stderr with fixed, source-free guidance. Explicit `--full` emits no warning and is mutually exclusive with page, filter, and cursor options before storage opens.

Reserve bounded page default behavior for 0.1.0. Its activation requires, in one release, a default page size of 50, retained `--full`, updated help, capabilities, and migration documentation, and split fixtures. This ADR alone does not activate it.

## Consequences

Existing automation could pin `--full`. ADR-0084 later completed the coordinated transition.
