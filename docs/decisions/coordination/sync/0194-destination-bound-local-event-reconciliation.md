# ADR-0194: Destination-bound local event reconciliation

Status: `accepted`
Decision date: 2026-08-24

## Context

The local event chain and outbound worker were implemented, but production event producers did not know the device-local Hub destination. Tests populated the outbox directly, masking the gap. A project with `hubSyncEnabled=true` and a healthy Node therefore registered at the Hub while every managed CLI and remote-provider event remained local. Making each producer read Node configuration would couple local execution to a Hub and duplicate destination policy across Codex, Claude, knowledge commands, and future producers.

The Hub accepts only a contiguous project chain as complete. Enqueuing future events without the earlier local prefix would leave the shared cursor permanently behind.

## Decision

After authenticated project registration and before claiming leases, `@lervo/sync` reconciles the authoritative local event chain with the Node's explicitly configured destination:

1. If the Hub cursor is nonzero, read the event at that exact local sequence and require the same event hash. A missing or different coordinate fails closed with `outbox_update_failed`.
2. Read at most the configured batch limit of local events after the authenticated Hub cursor.
3. In one synchronous transaction, idempotently enqueue each event for that destination.
4. Claim and transmit through the existing lease-bound worker. A synchronized loop immediately continues, so a long chain advances in bounded batches.

`hubSyncEnabled=false` still prevents Node startup. The Node configuration remains the sole device-local selection of Hub URL, credentials, destination ID, and expected Hub identity. Local CLI and provider adapters neither read that configuration nor wait for reconciliation, registration, or delivery.

The cycle result adds `enqueuedCount`, the number of new destination rows created in that cycle. It contains no event IDs, paths, payloads, repository coordinates, endpoint, credentials, or identities. `registration_deferred` always reports zero because no authenticated Hub cursor was accepted. Reconciliation emits no event, so it cannot recursively create sync work.

## Failure semantics

- Store read, transaction, or enqueue failure becomes `outbox_update_failed` and terminates the Node sync runtime through its existing `sync_runtime_failed` boundary.
- A Hub cursor that differs from local truth is not repaired or overwritten automatically.
- Hub unavailability occurs before reconciliation and leaves the local chain unchanged; the next successful registration retries discovery.
- Existing outbox rows remain idempotent. The local event chain is never mutated or deleted by reconciliation.

## Consequences

Any local producer can remain Hub-independent while a configured Node eventually discovers its sanitized events. Restart repairs the prior production gap without a one-off migration, and a new destination can receive the complete allowed local prefix. This does not synchronize CAS bodies or repository files, and registration or readiness alone still proves no delivery.

Fixtures cover an empty outbox, 205 events reconciled as 100/100/5, existing outbox gaps, registration failure, and Hub/local cursor conflict. The WSL Hub acceptance pilot verifies the same path with an actual repository and OS service.

## References

- [ADR-0003](../../operations/storage/0003-local-event-store-and-cas.md)
- [ADR-0035](0035-outbound-sync-worker.md)
- [ADR-0151](0151-restartable-node-outbound-sync-runtime.md)
