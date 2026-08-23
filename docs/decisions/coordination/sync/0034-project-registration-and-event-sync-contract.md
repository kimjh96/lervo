# ADR-0034: Project registration and contiguous-cursor event sync

Status: `accepted`
Decision date: 2026-08-19

## Context

SQLite outbox atomically enqueues events and manages leases/retries/acks, but project registration, batch boundaries, and durable Hub acknowledgement were undefined. Duplicate and out-of-order batches are normal; advancing a read model by arrival order could present a gapped trace as complete. Local runs must never depend on Hub availability.

## Decision

### Identity and mutable manifest

- Registration includes complete `ProjectManifest`, identity hash, manifest hash, destination, request time, and sync policy. It contains no repository source or credentials.
- Require `hubSyncEnabled=true` and `eventPayloadMode=allowlist`; artifact transfer is `none`.
- Identity hashes `schemaVersion`, `projectId`, and `createdAt`. Registration ID is full canonical SHA-256 of destination plus identity. Name/policy changes update the same identity; different creation identity at the same coordinates conflicts.
- Responses are `registered`, `updated`, or semantically `unchanged` excluding request time, and include the contiguous cursor.
- v0 permits one authoritative local event chain per registration. Independent clones producing different hashes at one sequence conflict; node/worktree authority is a later decision.

### Contiguous batches and out-of-order arrival

- `OutboundEventBatch` contains 1–100 events for one registration/project/destination. Within a batch, sequence increments by one and predecessor hashes connect. Duplicate first/last/predecessor/head coordinates and derive batch ID from full canonical content.
- Revalidate each event schema/hash and allowlist. If re-redaction removes or changes anything, reject the batch. No artifact/body/prompt/result/output/credential fields exist.
- Hub reducer compares `(projectId, seq)` and `(projectId, eventId)`. Exact replay is duplicate; different source at either coordinate is chain conflict.
- Durably retain events after a gap without advancing cursor. Advance only through the highest fully connected sequence after missing ranges arrive.

### Acknowledge only durable storage

`EventSyncAcknowledgement` binds registration/project/destination/batch, every event ID, `accepted` or `duplicate`, inserted/duplicate counts, current contiguous cursor, buffered count, and time.

Node accepts only an acknowledgement matching every coordinate. It may acknowledge a batch beyond a cursor gap once Hub durably buffered it; missing earlier batches continue retrying.

`@lervo/sync-contract` is a pure reducer and writes no file, DB, network, or outbox. A real Hub must commit registration, inbox, and cursor atomically before responding. A node acknowledges leases only after validating an authenticated transport response. This contract does not itself provide TLS or signatures.

### Failures

| Code | Meaning |
| --- | --- |
| `project_sync_disabled` | Policy disallows sync; create no registration or delivery. |
| `invalid_registration`, `registration_identity_conflict`, `registration_required` | Invalid coordinates, conflicting identity, or absent registration. |
| `invalid_event_batch`, `event_chain_conflict` | Invalid events/range/ID or conflicting chain. Preserve existing cursor/source. |
| `invalid_acknowledgement` | Response proves neither request nor counts; do not acknowledge local leases. |
| `invalid_sync_state` | Stored registration/events/cursor disagree; produce no new response. |

Add no local event. Emitting `sync.acknowledged` onto the same outbound chain would recursively create more sync work; outbox state remains local receipt until a local-only stream/exclusion rule exists. Failures contain machine codes, not manifests or payloads.

Fixtures cover registration isolation/update/disable, reverse batch arrival and later cursor advance, exact duplicate replay, project/sequence/hash/range/ack tampering, and allowlist rejection.

## Consequences

Local events/outbox remain independent of Hub. Hub can buffer out of order but never present an unverified contiguous trace. ADR-0035 connects authenticated transport and leases.
