# ADR-0074: Dependency-separated doctor scope plans

Status: `accepted`
Decision date: 2026-08-20

## Context

Only search had a narrow execution plan; knowledge, documents, skills, and providers still required full diagnostics. Extending scopes as filters would open hidden, unnecessary stores/directories/executables.

## Decision

| Scope | Checks | Dependencies opened |
| --- | --- | --- |
| `all` | all knowledge/environment/search | storage, CAS, documents, skills, provider probes, search |
| `knowledge` | event chain and candidate/review/verified/stale | project storage and CAS |
| `documents` | registry and sources | manifest and registered documents |
| `skills` | packages and lock | manifest, project/user skills, lock |
| `providers` | Codex/Claude runtime | manifest and two version probes |
| `search` | selection/policies/reviews/actions | manifest, search state/policies, registered corpus |

- Knowledge bypasses environment service; other narrow scopes open no event store/CAS.
- Search document reads are its own corpus dependency and do not add document-check results.
- Report composer exhaustively maps allowed check IDs per scope and rejects missing, duplicate, or cross-scope results.
- `all` and `knowledge` reuse one knowledge implementation.
- Text/JSON identify scope and exact checks; exit 0 certifies only requested scope. Reject unknown scope before project reads.

## Consequences

Every scope defines its real dependencies and cannot become a post-hoc filter or implicit full-health claim.
