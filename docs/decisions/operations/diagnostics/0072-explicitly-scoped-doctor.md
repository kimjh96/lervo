# ADR-0072: Explicit doctor execution scope

Status: `accepted`
Decision date: 2026-08-20

## Context

Filtering a full doctor result after execution wastes probes and can make excluded failures appear healthy. A search-only success must not imply whole-project health.

## Decision

- Default `lervo doctor` scope is `all`; explicit `--scope search` runs only the four search checks. Reject unsupported scope before opening project source.
- Scope is an execution plan, not output filtering.
- Every report includes `scope`. Text says only that scope was checked; JSON contains exactly its checks. Exit 0 means every check in requested scope is healthy and nothing about others.
- Search scope reads project manifest and required registered corpus/search sources only. It opens no event store/CAS and runs no document/skill/provider checks.
- Scope queries write nothing. New scopes must define exact check set, execution dependencies, and scope wording; never fill excluded checks as healthy.

## Consequences

Operators and automation can run fast, semantically bounded search diagnostics without mistaking them for full health.
