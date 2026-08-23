# ADR-0072: Explicit doctor execution scope

- Status: `accepted`
- Decision date: 2026-08-20

## Context

Filtering a full doctor result after execution wastes probes and can make excluded failures appear healthy. Success for search alone must not imply whole-project health.

## Decision

- The default `lervo doctor` scope is `all`. Explicit `--scope search` runs only the four search checks. Reject unsupported scopes before opening project sources.
- Scope defines the execution plan; it is not an output filter.
- Every report includes `scope`. Text states that only the selected scope was checked, and JSON contains exactly that scope's checks. Exit 0 means every requested check is healthy and says nothing about excluded checks.
- Search scope reads only the project manifest and required registered corpus and search sources. It opens no event store or CAS and runs no document, skill, or provider checks.
- Scope queries write nothing. Every new scope must define its exact check set, execution dependencies, and report wording. Excluded checks must never be synthesized as healthy.

## Consequences

Operators and automation can run fast, semantically bounded search diagnostics without interpreting them as full-project health.
