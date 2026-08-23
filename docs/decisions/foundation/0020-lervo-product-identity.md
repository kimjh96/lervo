# ADR-0020: Unified Lervo product identity

Status: `accepted`
Decision date: 2026-08-19

## Context

Multiple product and package names create unnecessary aliases across installation, imports, managed paths, and documentation. At pre-public `0.0.0`, they can still be unified. Because managed paths contain hash-chained events and CAS addresses, renaming a directory is not a safe evidence migration.

## Decision

Use one identity:

- Product: `Lervo`
- CLI and root package: `lervo`
- Managed path: `.lervo`
- npm scope: `@lervo/*`
- Schema/CAS URI/adapter/marker/skill prefix: `lervo`

Provide no previous-name CLI or package aliases and no dual managed paths. If `lervo init` finds legacy `.roven`, block before creating `.lervo`; do not read, edit, or delete it.

Any future identity migration must:

1. Snapshot and preserve the complete old tree and its bytes.
2. Define new references for the event hash chain, CAS objects, and URIs.
3. Keep the old layout active until the new layout is complete and verified.
4. On failure, remove the new layout and restore the old bytes and state.
5. Record completion and preservation coordinates without source bodies.

## Consequences

Code and documentation have one predictable identity. Repositories with experimental legacy state fail closed until an explicit migration prevents silent loss or concurrent event stores.
