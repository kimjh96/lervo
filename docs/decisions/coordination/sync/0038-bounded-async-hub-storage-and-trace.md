# ADR-0038: History-size-independent async Hub storage and bounded trace

Status: `accepted`
Decision date: 2026-08-19

## Context

The first durable Hub rebuilt an entire project event state for every batch and trace read. Correct for fixtures, its CPU/memory grows with history. A synchronous callback port also prevents PostgreSQL or remote stores from preserving commit-before-response semantics. Storage/query bounds must be fixed before HTTP and web views.

## Decision

### Async command port resolves after commit

- `HubSyncCommandStore` exposes only async `registerProject` and `acceptEventBatch`.
- Adapters resolve only after durable commit. Handler copies valid input, invokes the command, and awaits response.
- Do not expose transaction callbacks, connections, or full project state.
- Keep the full-state `sync-contract` reducer as a reference oracle; production may use incremental operations if results match.

### Incremental SQLite acceptance

- Registration reads/updates only project registration head and cursor.
- For a batch of at most 100, check each sequence/ID coordinate and adjacent predecessor/successor events; atomically insert and update cursor under `BEGIN IMMEDIATE`.
- Advance cursor through indexed next-sequence/first-gap queries, relying on insertion-time adjacency checks rather than reloading all history.
- Compute inserted/duplicate/buffered counts from batch results and aggregate queries. Roll back inserts and cursor together and return no acknowledgement on commit failure.
- Separate registration, inbox, trace query, audit, and lifecycle interfaces even when one SQLite store composes them.

### Cursor-paged trace at every level

`HubTraceSource` hides storage. Default page size is 50, maximum 100:

- Project cursor: destination/project IDs
- Run-list cursor: first project sequence and run ID
- Run-event cursor: last project sequence

Each source call returns summary and page from one read transaction. `hub_projects` counts, `hub_runs`, and `hub_run_sessions` are rebuildable derived indexes updated in the event transaction, avoiding full event JSON scans. When cursor advances, update only newly contiguous sequences.

Run summaries retain at most 16 session IDs in first-seen order plus full `sessionCount` and `sessionIdsTruncated`. Only bounded event pages return source envelopes while preserving `continuous`/`buffered`.

Invalid limits/cursors/coordinates are `invalid_query`; absent project/run remains `project_not_found`/`run_not_found`, never an invented empty source. HTTP may encode cursors but cannot change ordering semantics.

### Bounded startup versus explicit full audit

- Open-time `checkIntegrity` verifies foreign-key mode, required append-only triggers, and transaction-maintained global project/event count metadata without scanning pages, JSON, or chains.
- Explicit `auditIntegrity` runs SQLite quick/foreign-key checks and validates all registrations, schemas, hashes/chains, cursors, and derived run/session/global indexes.
- Operators run audits diagnostically or on schedule. Never claim bounded startup performed a full audit.
- Derived indexes are rebuildable. Future event segmentation extends audit by segment.

### Failures and privacy

Add no event/state. Preserve storage codes `closed`, `nested_transaction`, `transaction_async`, `read_failed`, `integrity_failed`, and `write_failed`; `transaction_async` is only an internal SQLite guard. Preserve sync identity/registration/chain conflicts.

Project summaries contain no payload/session IDs; run summaries contain only bounded IDs/counts; event pages contain only stored allowlisted events. Add no repository/document/skill source, prompts, output, authorization, or credentials. HTTP must authenticate and authorize before query ports.

Fixtures verify post-commit resolution, gaps/duplicates/rollback/outbox recovery, bounded pagination, deterministic cursors, retained allowed payloads, and a tampered event database passing bounded startup but failing explicit audit.

## Consequences

Batch cost depends on batch size and indexes, not total project history. Trace responses are bounded, and async stores can preserve commit-before-response. HTTP must build only on these bounded, pre-authorized ports.
