# ADR-0042: Durable remote-command delivery across restart and lost responses

Status: `accepted`
Decision date: 2026-08-19

## Context

Process-local receiving could not queue work while a node was offline or recover terminal receipts after restart. Event outbox and inbound commands have opposite direction and disposition and must not share table or acknowledgement semantics, though they can reuse registration and durable transactions.

## Decision

### Separate Hub command queue

- Add enqueue, lease, and acknowledgement ports to `@lervo/hub-sync`, implemented by separate Hub SQLite tables/repository.
- Require exact registered destination/project/identity. Derive delivery ID from destination plus complete signed envelope so distinct envelopes never merge under one command ID.
- States: `pending`, `leased`, `completed`, `rejected`, `expired`.
- Expired nonterminal leases return to pending. Do not lease before issue time; expire pending after command expiry without executor delivery. Compare UTC epoch milliseconds.
- Trigger-protect command identity/envelope/first-queued/expiry. Never auto-delete terminal rows.

### Lease-bound acknowledgement

Lease contains delivery/random lease/node IDs, lease interval, and envelope. Node acknowledgement binds delivery/lease/command ID/hash/time and either completed receipt or fixed rejection. Time must fall within lease.

Hub confirmation binds acknowledgement hash, disposition, accepted/duplicate, and commit time. Within one transaction, verify current lease, every coordinate, and receipt-command binding, commit terminal state, then respond. Lost post-commit response finds terminal state; pre-commit loss allows delivery after lease expiry.

### Project-bound node replay SQLite

- Bind database to project ID and identity hash.
- Store command hash, idempotency key, nonce, reservation, and terminal receipt only—no envelope, request, or exceptions.
- Default capacity 1,024, maximum 100,000; never evict.
- Atomically reserve unique coordinates. Same completed command recovers duplicate after restart. Incomplete reservation stays `in_progress` because executor outcome is unknowable; require operator action rather than auto-rerun.

### Reconnect worker

Pull leases through authenticated transport after verifying peer/destination. Recheck node/project/lease time, invoke existing receiver, and submit completed/rejected acknowledgement. Results: `offline`, `acknowledgement_pending`, `local_deferred`, `idle`, or `processed`, with executed/failed/duplicate/rejected counts. Payload/executor failures are not success. Worker owns neither polling daemon nor concrete TLS/HTTP.

Hub status exposes only delivery/command hash/project/state/time/attempts, not envelope. Node replay stores no artifact coordinates. Results exclude credentials, policy prose, and provider errors. Registration/identity/envelope/lease conflicts fail with stable codes; unverified peers/confirmations cannot complete execution. If node receipt commit fails after execution, send no acknowledgement. Add no event.

Restart/response-loss fixtures prove pending offline queue, exactly-once executor opening through duplicate replay, pre-lease expiry, tampered-envelope rejection, incomplete reservations/conflicts/capacity/project isolation, and absence of raw request/envelope in stored sources.

## Consequences

M6 durably recovers outbound events and inbound commands, but does not yet provide public HTTP command routes, real TLS, daemon scheduling, or multi-node operation. ADR-0043 adds signed policy/approval.
