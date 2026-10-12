# ADR-0003: Local Event Store, Outbox, and Content-Addressed Storage

- Status: `accepted`
- Decision date: 2026-08-18

Path amendment: [ADR-0213](0213-deletable-derived-state-boundary.md) moves durable event and CAS storage to `.lervo/data`. The original `.lervo/state` paths below describe the initial v0 layout and remain migration input only.

## Context

Local execution evidence must remain complete without a Hub, with ordering and links recoverable after restart. Raw prompts and document bodies must remain separate from event metadata. Appends, retries, and artifacts require immutable, idempotent storage.

## Decision

Local execution records events in SQLite, delivers them through a durable outbox and stores artifacts by content hash.

### SQLite event store

- Store events in `.lervo/state/events.sqlite` with project identity and schema-version metadata. Use Node.js 22.13's built-in synchronous `node:sqlite` API and a single writer; review this choice when upgrading Node.js.
- Allocate a project-wide sequence starting at 1. The first event has no predecessor; each later event records the previous project event hash.
- Compute `eventHash` as SHA-256 over canonical, key-sorted JSON of the complete envelope except `eventHash`. Array order matters; the shared event contract owns canonicalization.
- Allowlist payloads and remove sensitive fields before the transaction.
- `transact` is synchronous and rejects nested or asynchronous callbacks. Append resolves the tail, assigns sequence and hashes, validates the schema, and inserts. Any failure rolls back the entire callback.
- Use `user_version` migrations. Version 2 preserves events and adds the outbox and indexes.
- Event IDs are unique. Repeating an ID with the same sanitized event returns the existing record; different content fails with `event_id_conflict`.
- Triggers prohibit event updates and deletion. Enable WAL, `FULL` synchronous mode, foreign keys, and a five-second busy timeout without extensions.
- [ADR-0507](../../execution/verification/0507-verify-event-history-at-the-point-of-use.md) supersedes open-time complete verification. Opening checks the store binding; returned rows, appended predecessors and snapshot traversals are verified when used. Explicit `verifyIntegrity` still runs `quick_check` and validates complete schemas, sequence continuity, predecessor and event hashes, foreign keys, outbox coordinates, timestamps, leases, and failure fields. Integrity failure closes mutation paths.

### Durable outbox

- Append the event and enqueue its outbox row in one synchronous transaction. When Hub sync is disabled, record only the event.
- Use `(event_id, destination_id)` as the idempotency key. Rows are `pending`, `leased`, or `acknowledged`. Lease owner and expiry must coexist; acknowledged rows have no lease.
- Under `BEGIN IMMEDIATE`, claim in `available_at`, `enqueued_at`, event ID, and destination ID order; atomically set the lease and increment attempts.
- Active leases are exclusive. Expired leases may be reclaimed, incrementing attempts. Only the current lease owner may acknowledge or retry. Acknowledgement is idempotent; failure releases the lease and schedules the next attempt.
- Store only a lowercase failure code of at most 64 characters and its time. Never retain exception text, response bodies, credentials, or provider payloads.
- Cleanup may delete a bounded number of acknowledged rows older than a cutoff, never events or pending or leased work.
- A destination-scoped outstanding count includes pending and leased rows, excluding acknowledged rows. Reconciliation reads it within the same immediate transaction as enqueue: capacity rejection rolls back only the attempted projection, leaving the canonical source event discoverable. Invalid destinations retain `invalid_outbox_request`; an unreadable count is `integrity_failed`.

### Content-addressed storage

- Store blobs beneath `.lervo/state/cas` at `sha256/<first-two>/<remainder>`, identified as `lervo-cas://sha256/<64-hex-digest>`.
- Stream chunks to a temporary file while computing SHA-256 and byte count; never buffer the complete artifact. Remove the temporary file if production fails.
- `fsync` the temporary file, then publish with a same-filesystem hard link. Never overwrite an existing target; verify the target's actual digest.
- Reads verify the URI digest and byte count and reject symlinks and non-regular files.
- CAS is the sole artifact-body source. Events store only URI, digest, and byte count. Required-artifact failure stops changes. `has` returns false only for absence and propagates corruption.

### Failure semantics

| Store code                                                                                                                                                                           | Run meaning                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `closed`, `invalid_event`, `project_mismatch`, `event_id_conflict`, `nested_transaction`, `transaction_async`, `invalid_outbox_request`, `outbox_not_found`, `outbox_lease_conflict` | Stop with `contract_validation_failed` unless a narrower caller contract applies. |
| `integrity_failed`                                                                                                                                                                   | Stop with `telemetry_recording_failed` and close mutation paths.                  |
| CAS storage or verification failure                                                                                                                                                  | Stop with `artifact_storage_failed`; do not claim the artifact exists.            |

Errors and events contain only codes, digests, and bounded coordinates. They never contain raw rows, document bodies, prompts, credentials, or provider payloads.

## Consequences

- Local evidence, pending delivery, and artifacts survive restart without a Hub.
- The hash chain detects mutation but cannot prevent filesystem tampering; the database and WAL remain one backup unit.
- Content deduplication and retention are independent. Acknowledged outbox rows can be cleaned separately from immutable events.

## References

- Node.js `node:sqlite` documentation
- SQLite WAL and transaction documentation
