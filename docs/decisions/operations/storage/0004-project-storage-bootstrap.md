# ADR-0004: Project Storage Bootstrap

- Status: `accepted`
- Decision date: 2026-08-18

Path amendment: [ADR-0213](0213-deletable-derived-state-boundary.md) adds the durable `.lervo/data` boundary and automatic fail-closed relocation before this open sequence.

## Context

The project manifest, SQLite event and outbox store, and file CAS existed independently without a contract for opening them together. Combining different roots or project IDs could separate the manifest from execution evidence, while failure after a partial open could leak resources.

Composition cannot reside in `@lervo/project`: coupling project configuration to SQLite and CAS implementations would hinder backend replacement and test injection. A separate layer is required between configuration and concrete storage.

## Decision

### Package boundary

- `@lervo/project` handles only initialization, manifest validation, and managed-path calculation.
- `@lervo/project-storage` combines a verified project with concrete storage backends.
- Defaults are `@lervo/event-store-sqlite` and `@lervo/cas`; tests and future implementations may provide openers satisfying the same common contracts.
- The returned handle contains the manifest, canonical project path, event and outbox store, and artifact store as one unit.

### Open order and paths

1. Canonicalize the supplied repository root.
2. Read `.lervo/project.yaml` and validate it against the current schema.
3. Verify that `.lervo`, `.lervo/data`, `.lervo/state`, and existing `data/cas`, `data/cas/sha256`, and `data/cas/.tmp` entries are real directories; reject symbolic links.
4. Relocate exact legacy durable entries from `.lervo/state` to `.lervo/data` under ADR-0213.
5. Open the event and outbox store with the manifest project ID at `.lervo/data/events.sqlite`.
6. Open the artifact store at `.lervo/data/cas`.

The caller cannot separately provide a project ID or backend path; manifest identity and storage location derive from one path contract. A manifest with Hub disabled may still open local stores. Bootstrap does not automatically create outbox entries. After authenticated registration, a separately configured Node owns destination reconciliation under ADR-0194.

### Failure and cleanup

- Do not open a backend when the manifest or storage layout is invalid.
- If the event store belongs to another project, stop before opening CAS.
- If CAS opening fails, close the opened event store.
- If both opening and cleanup fail, report `cleanup_failed` with both causes; do not report successful cleanup.
- A normal handle's `close` reuses one Promise and closes each backend only once.

| Code | Meaning and disposition |
| --- | --- |
| `storage_layout_invalid` | A managed path is missing, is not a real directory, or is a symbolic link. Do not open backends. Upstream, treat this as `contract_validation_failed`; correct the path and validate again. |
| `cleanup_failed` | A later opening step and cleanup both failed after a partial open. Stop startup and require manual diagnosis; do not assume resources are closed. |

Existing `not_initialized`, manifest contract errors, event-store `project_mismatch`, and CAS errors retain their meanings. This decision adds no event type or persistent state. Error messages contain only managed paths and machine codes, never raw prompts, document bodies, credentials, or provider payloads.

## Consequences

- A later `lervo run` cannot arbitrarily combine project configuration with another storage root.
- Project configuration remains independent of concrete storage implementations.
- Backend fixtures can independently verify partial-open cleanup and repeated-close lifecycles.
- A real repository fixture can record events and artifacts, close stores, and reopen the same project to recover them.
- Local execution sources remain stored without Hub. A producer may enqueue atomically when it owns a destination; otherwise, an explicitly configured Node performs bounded destination reconciliation outside the local execution path.
