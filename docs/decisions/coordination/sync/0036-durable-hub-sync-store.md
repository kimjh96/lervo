# ADR-0036: Hub sync storage commits before responding

Status: `partially superseded`; ADR-0038 defines async command and incremental-acceptance boundaries
Decision date: 2026-08-19

## Context

Node completes local outbox rows only after a batch-bound Hub acknowledgement. If Hub responds after only mutating memory or commits registration/events/cursor separately, restart can lose accepted events or leave cursor ahead after the node stops retrying. Domain reduction must stay separate from SQLite mechanics.

## Decision

### Reducer, handler, adapter

- `@lervo/sync-contract` purely computes next state and response candidate.
- `@lervo/hub-sync` reads current project, invokes the reducer, and stores next state inside a synchronous transaction port; return a registration response/ack only after commit. Reject async callbacks.
- `@lervo/hub-sync-sqlite` owns schemas, migrations, transactions, and integrity for projects, event inbox, and cursor—not HTTP, authentication, authorization, or UI.
- Transport must authenticate/authorize before invoking the handler; the storage interface itself is not proof.

### Stored source and coordinates

- Lookup/conflict key is `(destinationId, projectId)`, not registration ID alone.
- A different creation identity at those coordinates reaches the reducer and conflicts. Same-identity manifest changes update request/hash while preserving events/cursor.
- `hub_projects` stores full registration request, registration/update time, and cursor. `hub_events` stores allowlisted full envelopes by project sequence.
- Revalidate indexes, event IDs/hashes/sequences, and JSON on open/write. Event rows are trigger-protected append-only; project rows cannot be deleted, while registration snapshot/cursor update only transactionally.

### One commit for registration, inbox, and cursor

- Respond to registration only after project-row commit.
- For a batch, read registration/inbox, reduce, then insert events and update cursor in one `BEGIN IMMEDIATE` transaction under WAL, `FULL`, foreign keys, and migrations.
- Re-read and compare planned state before commit; mismatch rolls back.
- A post-gap batch commits inbox without advancing cursor. Filling the gap rechecks chain and advances atomically.
- Exact replay inserts nothing and returns duplicate only after confirming committed state.
- Cursor-update failure rolls back inserted events, so retry starts as accepted.
- On open, verify SQLite quick check, foreign keys, triggers, schemas, chains, and cursors. Projects remain isolated even under one destination.

### Failures and privacy

| Code | Meaning |
| --- | --- |
| `closed`, `nested_transaction`, `transaction_async` | Invalid transaction lifecycle; return no response. |
| `read_failed` | Snapshot read/commit/rollback failed; return no partial result. |
| `integrity_failed` | Metadata/schema/trigger/coordinate/chain/cursor/SQLite check failed; do not open normally. |
| `state_conflict` | Attempt to rewind/change identity, cursor, or append-only events; preserve state. |
| `write_failed` | Transaction/insert/update/commit/rollback failed; return no durable acknowledgement. |

Hub DB contains project manifest and allowlisted events only. Contracts and errors exclude repository/document/skill source, prompts, output, authorization, and credentials. Add no event type.

SQLite and end-to-end outbox fixtures cover restart/update/isolation, reverse arrival and gap closure, duplicate replay, rollback on cursor trigger failure, and lost response followed by duplicate recovery.

## Consequences

Durable acceptance now reaches the actual commit boundary. Other durable stores can implement the same port. ADR-0037 defines trace projection and ADR-0150 authenticated HTTP reception.
