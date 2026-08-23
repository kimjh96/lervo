# ADR-0020: Unified Lervo product identity

Status: `accepted`
Decision date: 2026-08-19

## Context

Different product and package names create unnecessary aliases across installation, imports, managed paths, and documentation. At pre-public `0.0.0`, this can still be corrected. Managed paths contain hash-chained events and CAS addresses, so renaming a directory is not a safe evidence migration.

## Decision

Use one identity:

- Product: `Lervo`
- CLI and root package: `lervo`
- Managed path: `.lervo`
- npm scope: `@lervo/*`
- Schema/CAS URI/adapter/marker/skill prefix: `lervo`

Provide no previous-name CLI/package aliases or dual managed paths. If `lervo init` sees legacy `.roven`, block before creating `.lervo`; do not read, edit, or delete it.

A future identity migration must:

1. Snapshot and preserve the complete old tree and bytes.
2. Define new references for the event hash chain, CAS objects, and URIs.
3. Keep the old layout active until the new layout is complete and verified.
4. On failure, remove the new layout and restore old bytes/state.
5. Record completion and preservation coordinates without source bodies.

## Consequences

Code and documentation use one predictable identity. Repositories with experimental legacy state fail closed until an explicit migration prevents silent loss or concurrent event stores.
