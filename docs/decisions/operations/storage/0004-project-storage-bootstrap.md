# ADR-0004: Project Storage Bootstrap

Status: `accepted`
Decision date: 2026-08-18

## Context

The project manifest, SQLite event/outbox store, and file CAS existed independently, but there was no contract for opening them together at an execution entry point. If a caller combines a different root or project ID, the manifest and execution evidence can diverge. If the next step fails after only one store opens, resources can remain open.

Putting this composition in `@lervo/project` would make the project configuration layer depend on SQLite and CAS implementations. That would make it harder to replace a storage backend or inject a test implementation. A separate composition layer is needed between configuration and storage implementations.

## Decision

### Package boundary

- `@lervo/project` handles initialization, manifest validation, and managed-path calculation only.
- `@lervo/project-storage` combines a verified project with concrete storage backends.
- The default backends are `@lervo/event-store-sqlite` and `@lervo/cas`. Tests and future implementations may replace them with openers that satisfy the same common contracts.
- The returned handle provides the manifest, canonical project path, event/outbox store, and artifact store as one unit.

### Open order and paths

1. Canonicalize the supplied repository root.
2. Read `.lervo/project.yaml` and validate it against the current schema.
3. Verify that `.lervo`, `.lervo/state`, and any existing `cas`, `cas/sha256`, and `cas/.tmp` entries are real directories; reject symbolic links.
4. Open the event/outbox store using the manifest project ID and `.lervo/state/events.sqlite`.
5. Open the artifact store at `.lervo/state/cas`.

The caller does not provide a project ID or backend path separately. Manifest identity and actual storage location therefore come from one path contract. A manifest with Hub disabled can still open local stores, and bootstrap does not create outbox entries automatically.

### Failure and cleanup

- Do not open a backend when the manifest or storage layout is invalid.
- If the event store belongs to another project, stop before opening CAS.
- If opening CAS fails, close the already-open event store.
- If the original open failure and cleanup both fail, `cleanup_failed` preserves both causes. Do not record cleanup as successful.
- A normal handle's `close` reuses the same Promise and closes each backend only once.

| Code | Meaning and disposition |
|---|---|
| `storage_layout_invalid` | A managed path is missing, is not a regular directory, or is a symbolic link. Do not open backends; treat it as `contract_validation_failed` upstream. Correct the path and validate again. |
| `cleanup_failed` | Both a later opening step and resource cleanup failed after a partial open. Stop run startup and require manual diagnosis. Do not assume resources are closed. |

Existing `not_initialized`, manifest contract errors, event-store `project_mismatch`, and CAS errors retain their meanings. This decision adds no event type or persistent state. Error messages include only managed paths and machine codes, never raw prompts, document bodies, credentials, or provider payloads.

## Consequences

- A later `lervo run` cannot arbitrarily combine project configuration with a different storage root.
- The project configuration layer does not depend on concrete storage implementations.
- Backend-specific fixtures can independently verify resource lifecycles for partial-open failure and repeated close.
- A real repository fixture can record events and artifacts, close them, and reopen the same project to recover them.
- Local execution sources remain stored without Hub; synchronization remains an explicit caller-owned outbox operation.
