# ADR-0036: Hub Sync Storage Commits Before Responding

- Status: `partially superseded`; ADR-0038 defines asynchronous command and incremental-acceptance boundaries
- Decision date: 2026-08-19

## Context

A Node completes local outbox rows only after a batch-bound Hub acknowledgement. Responding after only mutating memory can lose accepted events on restart. Committing registration, events, and cursor separately can leave the cursor ahead after the Node stops retrying. Domain reduction must remain separate from SQLite mechanics.

## Decision

### Reducer, handler, and adapter

- `@lervo/sync-contract` purely computes the next state and response candidate.
- `@lervo/hub-sync` reads the current project, invokes the reducer, and stores the next state through a synchronous transaction port. It rejects asynchronous callbacks and returns a registration response or acknowledgement only after commit.
- `@lervo/hub-sync-sqlite` owns schemas, migrations, transactions, and integrity for projects, the event inbox, and the cursor. It does not own HTTP, authentication, authorization, or UI.
- Transport must authenticate and authorize before invoking the handler. The storage interface proves neither.

### Stored source and coordinates

- Use `(destinationId, projectId)`, not registration ID alone, as the lookup and conflict key.
- At those coordinates, a different creation identity reaches the reducer and conflicts. Same-identity manifest changes update the request and hash while preserving events and cursor.
- `hub_projects` stores the full registration request, registration or update time, and cursor. `hub_events` stores full allowlisted envelopes by project sequence.
- Revalidate indexes, event IDs, hashes, sequences, and JSON on open and write.
- Trigger-protect event rows as append-only. Project rows cannot be deleted. Registration snapshots and cursors change only transactionally.

### One commit for registration, inbox, and cursor

- Respond to registration only after committing the project row.
- For a batch, read registration and inbox state, reduce, then insert events and update the cursor in one `BEGIN IMMEDIATE` transaction using WAL, `FULL`, foreign keys, and migrations.
- Re-read and compare planned state before commit; roll back on mismatch.
- A post-gap batch commits inbox events without advancing the cursor. Filling the gap rechecks the chain and advances atomically.
- Exact replay inserts nothing and returns `duplicate` only after confirming committed state.
- Cursor-update failure rolls back inserted events, so retry begins as `accepted`.
- On open, verify SQLite quick check, foreign keys, triggers, schemas, chains, and cursors. Projects remain isolated even under one destination.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `closed`, `nested_transaction`, `transaction_async` | Transaction lifecycle is invalid; return no response. |
| `read_failed` | Snapshot read, commit, or rollback failed; return no partial result. |
| `integrity_failed` | Metadata, schema, trigger, coordinate, chain, cursor, or SQLite validation failed; do not open normally. |
| `state_conflict` | An operation attempts to rewind or change identity, cursor, or append-only events; preserve state. |
| `write_failed` | Transaction, insert, update, commit, or rollback failed; return no durable acknowledgement. |

The Hub database contains only project manifests and allowlisted events. Contracts and errors exclude repository, document, and skill source; prompts; output; authorization; and credentials. Add no event type.

SQLite and end-to-end outbox fixtures cover restart, update, and isolation; reverse arrival and gap closure; duplicate replay; rollback on cursor-trigger failure; and a lost response followed by duplicate recovery.

## Consequences

Durable acceptance reaches the actual commit boundary. Other durable stores can implement the same port. ADR-0037 defines trace projection, and ADR-0150 defines authenticated HTTP reception.
