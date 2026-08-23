# ADR-0038: History-size-independent async Hub storage and bounded trace

Status: `accepted`
Decision date: 2026-08-19

## Context

The first durable Hub rebuilt complete project event state for every batch and trace read, making CPU and memory grow with history. Its synchronous callback port also prevented PostgreSQL or remote stores from preserving commit-before-response semantics. Storage and query bounds must be fixed before adding HTTP and web views.

## Decision

### Async command port resolves after commit

- `HubSyncCommandStore` exposes only async `registerProject` and `acceptEventBatch`.
- Adapters resolve only after durable commit. The handler copies valid input, invokes the command, and awaits its response.
- Ports expose neither transaction callbacks, connections, nor full project state.
- The full-state `sync-contract` reducer remains the reference oracle; incremental production operations must produce matching results.

### Incremental SQLite acceptance

- Registration accesses only the project registration head and cursor.
- For batches of at most 100, check every sequence/ID coordinate and adjacent predecessor/successor event. Atomically insert events and update the cursor under `BEGIN IMMEDIATE`.
- Advance the cursor with indexed next-sequence and first-gap queries, relying on insertion-time adjacency checks instead of reloading history.
- Derive inserted, duplicate, and buffered counts from batch results and aggregate queries.
- On commit failure, roll back inserts and cursor together and return no acknowledgement.
- Keep registration, inbox, trace-query, audit, and lifecycle interfaces separate even when one SQLite store implements them.

### Cursor-paged trace at every level

`HubTraceSource` hides storage. Its default page size is 50 and maximum is 100. Cursors are:

- Project: destination/project IDs.
- Run list: first project sequence and run ID.
- Run event: last project sequence.

Each source call returns its summary and page from one read transaction. Rebuildable `hub_projects` counts, `hub_runs`, and `hub_run_sessions` indexes are updated in the event transaction to avoid full event JSON scans. Cursor advancement updates only newly contiguous sequences.

Run summaries retain at most 16 session IDs in first-seen order, plus complete `sessionCount` and `sessionIdsTruncated`. Only bounded event pages return source envelopes, preserving `continuous` and `buffered`.

Invalid limits, cursors, or coordinates return `invalid_query`. Missing projects or runs return `project_not_found` or `run_not_found`, never an invented empty source. HTTP may encode cursors but cannot alter ordering semantics.

### Bounded startup versus explicit full audit

- Open-time `checkIntegrity` checks foreign-key mode, required append-only triggers, and transaction-maintained global project/event count metadata without scanning pages, JSON, or chains.
- Explicit `auditIntegrity` runs SQLite quick and foreign-key checks, then validates all registrations, schemas, hashes/chains, cursors, and derived run/session/global indexes.
- Operators run audits diagnostically or on a schedule. Bounded startup must never be represented as a full audit.
- Derived indexes are rebuildable; future event segmentation extends auditing by segment.

### Failures and privacy

Add no event or state. Preserve storage codes `closed`, `nested_transaction`, `transaction_async`, `read_failed`, `integrity_failed`, and `write_failed`; `transaction_async` remains an internal SQLite guard. Preserve sync identity, registration, and chain conflicts.

Project summaries contain no payload or session IDs. Run summaries contain only bounded IDs and counts. Event pages contain only stored allowlisted events. Add no repository, document, or skill source; prompts; output; authorization data; or credentials. HTTP must authenticate and authorize before invoking query ports.

Fixtures verify post-commit resolution, gaps, duplicates, rollback, outbox recovery, bounded pagination, deterministic cursors, retained allowed payloads, and that a tampered event database passes bounded startup but fails explicit audit.

## Consequences

Batch cost depends on batch size and indexes rather than total project history. Trace responses are bounded, and async stores preserve commit-before-response. HTTP must use only these bounded, pre-authorized ports.
