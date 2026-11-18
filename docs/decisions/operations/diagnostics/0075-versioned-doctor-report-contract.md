# ADR-0075: Versioned doctor-report compatibility contract

- Status: `accepted`
- Decision date: 2026-08-20

Amended by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Doctor report v2 removes the knowledge candidate, review, verified knowledge, and staleness checks with their issue and action codes; the `knowledge` scope reports only `event_chain`. V2 readers reject v1 reports as unsupported.

## Context

Machine-readable doctor reports lacked a version. A version number alone is insufficient unless readers also validate cross-field semantics such as scope and check-set agreement, overall state, and recovery guidance.

## Decision

- Define the Draft 2020-12 `doctorReportSchema` in `@lervo/schemas`, requiring `schemaVersion: 1`, and derive its TypeScript types from the schema.
- V1 readers return `doctor_report_schema_unsupported` for an integer version other than 1. They return `doctor_report_invalid` for missing or incorrectly typed fields, invalid controlled values, or inconsistent scope, checks, status, or guidance.
- Permit optional additive fields at report and subobject levels so older readers may ignore them.
- Removing fields, adding required fields, changing types, or adding or changing controlled scope, status, check, issue, or action values requires a new schema version.
- Validation errors never echo the input or JSON source. Readers only read and validate; they mutate no state.

## Consequences

Automation can distinguish an unsupported version from a damaged v1 report and cannot interpret new semantics as an old healthy result.
