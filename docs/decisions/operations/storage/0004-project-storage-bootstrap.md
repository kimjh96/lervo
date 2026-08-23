# ADR-0004: Project Storage Bootstrap

- Status: `accepted`
- Decision date: 2026-08-18

## Context

The project manifest, SQLite event and outbox store, and file CAS existed independently, but execution entry points lacked a contract for opening them together. Combining a different root or project ID could separate the manifest from execution evidence, while failure after one store opened could leak resources.

Putting this composition in `@lervo/project` would couple project configuration to SQLite and CAS implementations, hindering backend replacement and test injection. Composition therefore needs a separate layer between configuration and concrete storage.

## Decision

### Package boundary

- `@lervo/project` handles initialization, manifest validation, and managed-path calculation only.
- `@lervo/project-storage` combines a verified project with concrete storage backends.
- Default backends are `@lervo/event-store-sqlite` and `@lervo/cas`. Tests and future implementations may supply openers satisfying the same common contracts.
- The returned handle contains the manifest, canonical project path, event and outbox store, and artifact store as one unit.

### Open order and paths

1. Canonicalize the supplied repository root.
2. Read `.lervo/project.yaml` and validate it against the current schema.
3. Verify that `.lervo`, `.lervo/state`, and existing `cas`, `cas/sha256`, and `cas/.tmp` entries are real directories; reject symbolic links.
4. Open the event and outbox store with the manifest project ID at `.lervo/state/events.sqlite`.
5. Open the artifact store at `.lervo/state/cas`.

The caller cannot separately provide a project ID or backend path. Manifest identity and storage location therefore derive from one path contract. A manifest with Hub disabled may still open local stores, and bootstrap does not automatically create outbox entries. A separately configured Node owns destination reconciliation after authenticated registration under ADR-0194.

### Failure and cleanup

- Do not open a backend if the manifest or storage layout is invalid.
- If the event store belongs to another project, stop before opening CAS.
- If CAS opening fails, close the event store already opened.
- If both the original open and cleanup fail, `cleanup_failed` preserves both causes; do not report cleanup as successful.
- A normal handle's `close` reuses one Promise and closes each backend only once.

| Code | Meaning and disposition |
| --- | --- |
| `storage_layout_invalid` | A managed path is missing, is not a real directory, or is a symbolic link. Do not open backends. Treat it upstream as `contract_validation_failed`; correct the path and validate again. |
| `cleanup_failed` | A later opening step and cleanup both failed after a partial open. Stop startup and require manual diagnosis; do not assume resources are closed. |

Existing `not_initialized`, manifest contract errors, event-store `project_mismatch`, and CAS errors retain their meanings. This decision adds no event type or persistent state. Error messages include only managed paths and machine codes, never raw prompts, document bodies, credentials, or provider payloads.

## Consequences

- A later `lervo run` cannot arbitrarily combine project configuration with another storage root.
- The project configuration layer remains independent of concrete storage implementations.
- Backend fixtures can independently verify partial-open cleanup and repeated-close lifecycles.
- A real repository fixture can record events and artifacts, close stores, and reopen the same project to recover them.
- Local execution sources remain stored without Hub. A producer may enqueue atomically when it owns a destination; otherwise, an explicitly configured Node performs bounded destination reconciliation outside the local execution path.
