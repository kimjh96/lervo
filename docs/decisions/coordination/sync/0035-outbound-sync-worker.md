# ADR-0035: Authenticated-peer, lease-bound outbound sync worker

Status: `accepted`
Decision date: 2026-08-19

## Context

The sync contract and SQLite outbox defined batch semantics and retry state separately. If Hub stores a batch but its response is lost, guessing local acknowledgement loses recoverability. Network/authentication/batching/SQLite transitions must also remain separate, and a synced acknowledgement event on the same chain would recurse.

## Decision

### Register before claiming leases

- `@lervo/sync` executes one outbound cycle.
- Build a registration request from current manifest and verify destination/peer-authenticated response. On failure, claim no outbox row; return `registration_deferred`, safe failure code, and next attempt.
- After registration, reconcile a bounded local prefix after the authenticated Hub cursor into the explicitly configured destination outbox as specified by ADR-0194.
- After registration, claim at most 100 pending rows for that destination and revalidate lease ownership.
- Sort by sequence and split into contiguous hash-chain ranges. Gaps may become separate valid batches; Hub buffers later ranges while preserving cursor.

### Authenticated transport and coordinate checks

`AuthenticatedHubTransport` only registers and sends batches. Implementations must authenticate peers through TLS, signatures, or equivalent and return `status=verified`, destination, and peer-identity hash. The interface alone is not cryptographic proof.

Before reading response bodies, worker requires exact destination and configured peer hash. Then validate registration/ack schema and every request coordinate/count/event ID before acknowledging.

### Transactional local transitions

- Move all rows in a durably acknowledged batch to `acknowledged` in one transaction. Store local worker transition time, not Hub time. Partial transition is failure.
- On transport/auth/ack failure, atomically return all unacknowledged leases to `pending` with one availability time.
- Lost responses resend the same canonical batch ID; a matching Hub `duplicate` response then acknowledges locally.
- Preserve successful earlier batches when a later one fails.
- Emit no `sync.acknowledged`; outbox is the local receipt.

Cycle states are `registration_deferred`, `idle`, `synchronized`, and `retry_scheduled` with enqueued, acknowledged, and rescheduled counts. Counts disclose no event coordinates or payloads.

| Code | Meaning |
| --- | --- |
| `hub_unavailable` | Unknown remote storage outcome; retry same lease/batch. |
| `transport_authentication_failed` | Missing/mismatched peer proof; trust no body or ack. |
| `invalid_registration_response` | Invalid registration response; claim no rows. |
| `invalid_sync_ack` | Response does not prove complete batch; retry remaining rows. |
| `local_batch_invalid` | Leased events cannot form valid batches. |
| `invalid_worker_configuration` | Invalid manifest/clock/worker/peer/limits; do not start. |
| `outbox_update_failed` | Lease ownership or atomic ack/reschedule failed; report no partial success. |

Store only retry code and time in outbox. Results exclude transport exceptions, HTTP bodies, manifest/events, authorization, and credentials.

SQLite fixtures cover success/idle, registration failure without attempt increment, split gaps, peer/ack rejection, response loss after remote commit, duplicate recovery with identical batch ID, and unchanged source-event count.

## Consequences

Core worker depends only on store, transport, and clock ports. Local execution remains Hub-independent and reconnect recovers through deterministic replay. ADR-0194 defines destination reconciliation, ADR-0036 defines Hub storage, and ADR-0150 supplies authenticated HTTP transport.
