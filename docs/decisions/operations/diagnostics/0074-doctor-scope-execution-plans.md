# ADR-0074: Dependency-separated doctor scope plans

- Status: `accepted`
- Decision date: 2026-08-20

## Context

Only search had a narrow execution plan. Knowledge, document, skill, and provider diagnostics still required the full doctor. Implementing additional scopes as filters would open hidden and unnecessary stores, directories, and executables.

## Decision

| Scope | Checks | Dependencies opened |
| --- | --- | --- |
| `all` | All knowledge, environment, and search checks | Storage, CAS, documents, skills, provider probes, and search |
| `knowledge` | Event chain and candidate, review, verified, and stale checks | Project storage and CAS |
| `documents` | Registry and sources | Manifest and registered documents |
| `skills` | Packages and lock | Manifest, project and user skills, and lock |
| `providers` | Codex and Claude runtimes | Manifest and two version probes |
| `search` | Selection, policies, reviews, and actions | Manifest, search state and policies, and registered corpus |

- `knowledge` bypasses the environment service. Other narrow scopes open no event store or CAS.
- Document reads required by `search` are corpus dependencies and do not add document-check results.
- The report composer exhaustively maps allowed check IDs for each scope and rejects missing, duplicate, or cross-scope results.
- `all` and `knowledge` reuse one knowledge implementation.
- Text and JSON identify the scope and exact checks. Exit 0 certifies only the requested scope.
- Reject unknown scopes before reading the project.

## Consequences

Every scope declares its actual dependencies and cannot become a post-hoc filter or an implicit full-health claim.
