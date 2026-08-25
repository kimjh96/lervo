# ADR-0034: Project Registration and Contiguous-Cursor Event Sync

- Status: `accepted`
- Decision date: 2026-08-19

## Context

The SQLite outbox atomically enqueues events and manages leases, retries, and acknowledgements, but project registration, batch boundaries, and durable Hub acknowledgement were undefined. Duplicate and out-of-order batches are normal. Advancing a read model by arrival order could present a gapped trace as complete. Local runs must never depend on Hub availability.

## Decision

### Identity and mutable manifest

- Registration includes the complete `ProjectManifest`, identity hash, manifest hash, destination, request time, and sync policy, but no repository source or credentials.
- Require `hubSyncEnabled=true` and `eventPayloadMode=allowlist`; artifact transfer is `none`.
- Identity hashes `schemaVersion`, `projectId`, and `createdAt`. The registration ID is the full canonical SHA-256 of destination plus identity.
- Name or policy changes update the same identity. A different creation identity at the same coordinates conflicts.
- Responses are `registered`, `updated`, or semantically `unchanged` excluding request time, and include the contiguous cursor.
- v0 permits one authoritative local event chain per registration. Independent clones producing different hashes at one sequence conflict; node and worktree authority are deferred.

### Contiguous batches and out-of-order arrival

- `OutboundEventBatch` contains 1–100 events for one registration, project, and destination.
- Within a batch, sequences increment by one and predecessor hashes connect. Duplicate first, last, predecessor, and head coordinates, and derive the batch ID from full canonical content.
- Revalidate every event schema, hash, and allowlist. Reject the batch if re-redaction removes or changes anything. Artifact, body, prompt, result, output, and credential fields do not exist.
- The Hub reducer compares `(projectId, seq)` and `(projectId, eventId)`. An exact replay is a duplicate; a different source at either coordinate is a chain conflict.
- Durably retain events received after a gap without advancing the cursor. Advance only through the highest fully connected sequence after missing ranges arrive.

### Acknowledge only durable storage

`EventSyncAcknowledgement` binds registration, project, destination, batch, every event ID, `accepted` or `duplicate`, inserted and duplicate counts, the current contiguous cursor, buffered count, and time.

The Node accepts only an acknowledgement matching every coordinate. It may acknowledge a batch beyond a cursor gap after the Hub durably buffers it; missing earlier batches continue retrying.

`@lervo/sync-contract` is a pure reducer and writes no file, database, network, or outbox. A real Hub must atomically commit registration, inbox, and cursor before responding. A Node acknowledges leases only after validating an authenticated transport response. This contract supplies neither TLS nor signatures.

### Failures

| Code | Meaning |
| --- | --- |
| `project_sync_disabled` | Policy disallows sync; create no registration or delivery. |
| `invalid_registration`, `registration_identity_conflict`, `registration_required` | Coordinates are invalid, identity conflicts, or registration is absent. |
| `invalid_event_batch`, `event_chain_conflict` | Events, range, or ID are invalid, or the chain conflicts. Preserve the existing cursor and source. |
| `invalid_acknowledgement` | The response proves neither request nor counts; do not acknowledge local leases. |
| `invalid_sync_state` | Stored registration, events, and cursor disagree; produce no response. |

Add no local event. Emitting `sync.acknowledged` on the same outbound chain would recursively create sync work; the outbox remains the local receipt until a local-only stream or exclusion rule exists. Failures contain machine codes, not manifests or payloads.

Fixtures cover registration isolation, update, and disablement; reverse batch arrival and later cursor advancement; exact duplicate replay; project, sequence, hash, range, and acknowledgement tampering; and allowlist rejection.

## Consequences

Local events and the outbox remain independent of the Hub. The Hub can buffer out-of-order events but never present an unverified contiguous trace. ADR-0035 connects authenticated transport and leases.
