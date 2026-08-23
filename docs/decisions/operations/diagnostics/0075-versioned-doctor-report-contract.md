# ADR-0075: Versioned doctor-report compatibility contract

Status: `accepted`
Decision date: 2026-08-20

## Context

Machine-readable doctor reports lacked a version. A number alone is insufficient unless readers also validate cross-field semantics such as scope/check set, overall state, and recovery guidance.

## Decision

- Define Draft 2020-12 `doctorReportSchema` in `@lervo/schemas` with required `schemaVersion: 1`; derive TypeScript types from it.
- V1 readers distinguish `doctor_report_schema_unsupported` for an integer version other than 1 from `doctor_report_invalid` for missing/wrong fields/controlled values or inconsistent scope/check/status/guidance.
- Allow optional additive fields at report/subobject levels so old readers may ignore them.
- Field removal, new required fields, type changes, or new/changed controlled scope/status/check/issue/action values require a new schema version.
- Validation errors never echo input/JSON source. Readers only read/validate and mutate no state.

## Consequences

Automation distinguishes unknown versions from damaged v1 and cannot interpret new semantics as old healthy output.
