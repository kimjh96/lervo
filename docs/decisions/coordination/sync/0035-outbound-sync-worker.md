# ADR-0035: Authenticated-Peer, Lease-Bound Outbound Sync Worker

- Status: `accepted`
- Decision date: 2026-08-19

## Context

The sync contract and SQLite outbox separately defined batch semantics and retry state. If the Hub stores a batch but its response is lost, guessing local acknowledgement destroys recoverability. Network, authentication, batching, and SQLite transitions must remain separate. A synced acknowledgement event on the same chain would recurse.

## Decision

### Register before claiming leases

- `@lervo/sync` executes one outbound cycle.
- Build a registration request from the current manifest and verify the destination and peer-authenticated response. On failure, claim no outbox row; return `registration_deferred`, a safe failure code, and the next attempt.
- After registration, reconcile a bounded local prefix after the authenticated Hub cursor into the explicitly configured destination outbox as specified by ADR-0194.
- Then claim at most 100 pending rows for that destination and revalidate lease ownership.
- Sort rows by sequence and split them into contiguous hash-chain ranges. Gaps may form separate valid batches; the Hub buffers later ranges while preserving its cursor.

### Authenticated transport and coordinate checks

`AuthenticatedHubTransport` only registers and sends batches. Implementations must authenticate peers through TLS, signatures, or equivalent and return `status=verified`, the destination, and a peer-identity hash. The interface alone is not cryptographic proof.

Before reading response bodies, the worker requires the exact destination and configured peer hash. It then validates the registration or acknowledgement schema and every request coordinate, count, and event ID before acknowledging.

### Transactional local transitions

- Move every row in a durably acknowledged batch to `acknowledged` in one transaction. Store local worker transition time, not Hub time. A partial transition is a failure.
- On transport, authentication, or acknowledgement failure, atomically return all unacknowledged leases to `pending` with one availability time.
- A lost response resends the same canonical batch ID. A matching Hub `duplicate` response then permits local acknowledgement.
- Preserve successful earlier batches when a later batch fails.
- Emit no `sync.acknowledged`; the outbox is the local receipt.

Cycle states are `registration_deferred`, `idle`, `synchronized`, and `retry_scheduled`, with enqueued, acknowledged, and rescheduled counts. Counts disclose no event coordinates or payloads.

| Code | Meaning |
| --- | --- |
| `hub_unavailable` | Remote storage outcome is unknown; retry the same lease and batch. |
| `transport_authentication_failed` | Peer proof is missing or mismatched; trust no body or acknowledgement. |
| `invalid_registration_response` | Registration response is invalid; claim no rows. |
| `invalid_sync_ack` | Response does not prove the complete batch; retry remaining rows. |
| `local_batch_invalid` | Leased events cannot form valid batches. |
| `invalid_worker_configuration` | Manifest, clock, worker, peer, or limits are invalid; do not start. |
| `outbox_update_failed` | Lease ownership or atomic acknowledgement/reschedule failed; report no partial success. |

Store only the retry code and time in the outbox. Results exclude transport exceptions, HTTP bodies, manifests, events, authorization, and credentials.

SQLite fixtures cover success and idle cycles, registration failure without attempt increment, split gaps, peer and acknowledgement rejection, response loss after remote commit, duplicate recovery with an identical batch ID, and an unchanged source-event count.

## Consequences

The core worker depends only on store, transport, and clock ports. Local execution remains Hub-independent, and reconnecting recovers through deterministic replay. ADR-0194 defines destination reconciliation, ADR-0036 defines Hub storage, and ADR-0150 supplies authenticated HTTP transport.
