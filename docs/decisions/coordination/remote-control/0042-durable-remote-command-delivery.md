# ADR-0042: Durable remote-command delivery across restart and lost responses

Status: `accepted`
Decision date: 2026-08-19

## Context

Process-local receiving cannot queue work while a node is offline or recover terminal receipts after restart. Event outbox and inbound commands have opposite directions and dispositions, so they must not share tables or acknowledgement semantics, though they may reuse registration and durable transactions.

## Decision

### Separate Hub command queue

- Add enqueue, lease, and acknowledgement ports to `@lervo/hub-sync`, backed by separate Hub SQLite tables and repository.
- Require an exact registered destination, project, and identity. Derive delivery ID from the destination and complete signed envelope so distinct envelopes never merge under one command ID.
- States are `pending`, `leased`, `completed`, `rejected`, and `expired`.
- Return expired nonterminal leases to pending. Do not lease before issue time; expire pending commands after command expiry without executor delivery. Compare UTC epoch milliseconds.
- Protect command identity, envelope, first-queued time, and expiry with triggers. Never automatically delete terminal rows.

### Lease-bound acknowledgement

A lease contains delivery, random lease, and node IDs; lease interval; and envelope. Node acknowledgement binds delivery, lease, command ID, hash, and time, plus either a completed receipt or fixed rejection. Its time must fall within the lease.

Hub confirmation binds acknowledgement hash, disposition, accepted/duplicate status, and commit time. In one transaction, verify the current lease, all coordinates, and receipt-command binding; commit terminal state; then respond. A lost post-commit response finds terminal state, while pre-commit loss permits delivery after lease expiry.

### Project-bound node replay SQLite

- Bind the database to project ID and identity hash.
- Store only command hash, idempotency key, nonce, reservation, and terminal receipt—never envelope, request, or exceptions.
- Default capacity is 1,024 and maximum is 100,000; never evict.
- Atomically reserve unique coordinates. The same completed command recovers as a duplicate after restart. An incomplete reservation remains `in_progress` because executor outcome is unknowable; require operator action rather than automatic rerun.

### Reconnect worker

Pull leases through authenticated transport after verifying peer and destination. Recheck node, project, and lease time; invoke the existing receiver; and submit a completed or rejected acknowledgement. Results are `offline`, `acknowledgement_pending`, `local_deferred`, `idle`, or `processed`, with executed, failed, duplicate, and rejected counts. Payload and executor failures are not success. The worker owns neither a polling daemon nor concrete TLS/HTTP.

Hub status exposes only delivery, command hash, project, state, time, and attempts—not the envelope. Node replay stores no artifact coordinates. Results exclude credentials, policy prose, and provider errors. Registration, identity, envelope, and lease conflicts use stable codes. Unverified peers or confirmations cannot complete execution. If the node cannot commit its receipt after execution, send no acknowledgement. Add no event.

Restart and response-loss fixtures prove offline queuing, exactly-once executor opening through duplicate replay, pre-lease expiry, tampered-envelope rejection, incomplete reservations, conflicts, capacity, project isolation, and absence of raw requests or envelopes in stored sources.

## Consequences

M6 durably recovers outbound events and inbound commands, but does not provide public HTTP command routes, real TLS, daemon scheduling, or multi-node operation. ADR-0043 adds signed policy and approval.
