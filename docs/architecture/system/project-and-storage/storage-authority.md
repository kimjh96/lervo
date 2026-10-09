# Storage authority

`.lervo/project.yaml` identifies the repository and privacy defaults. Durable records reside in gitignored `.lervo/data`; rebuildable projections reside in `.lervo/state`. Runtime directories are created lazily. Legacy relocation is atomic and fails closed on conflicting copies.

The optional `.lervo/data/event-contract.json` is the versioned, Lervo-managed future-write coordinate. Absence selects event schema version 1. `@lervo/project` validates and recovers it before project storage injects the selection into the event-store adapter. Indexes, graphs, and projections cannot change writer authority.

Active continuation resides in `.lervo/state/workstreams/current.json`. CAS in `.lervo/data/cas` stores exact snapshots and optional legacy-source bytes. `workstream.snapshot.recorded` binds revision and content coordinates without event prose.

Migration discovers candidates from bounded content structure without requiring names or locations. Before returning context, Lervo rebuilds a missing projection from the latest event and CAS bytes. Canonical Markdown retains long-term facts.

Event pages support filtering by exact event types; omitting the filter returns every type. The SQLite adapter serves filtered pages from the `(project_id, type, seq)` index. Opening a writable store creates the index idempotently outside the versioned schema, leaving `user_version` and exact-version read-only readers unchanged. Stores without the index return the same rows more slowly.

Repeated integrity checks still read the complete raw event history. The adapter reuses schema/hash verification only for byte-identical pages with the same incoming chain hash, using disposable receipts on that connection. SQLite structure, foreign-key, and outbox checks remain independent. [ADR-0497](../../../decisions/operations/storage/0497-reuse-exact-event-page-verification.md) defines invalidation and evidence-collection reuse.
