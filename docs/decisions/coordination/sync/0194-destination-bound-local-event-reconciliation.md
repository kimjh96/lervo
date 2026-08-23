# ADR-0194: Destination-bound local event reconciliation

Status: `accepted`
Decision date: 2026-08-24

## Context

The local event chain and outbound worker existed, but production event producers did not know the device-local Hub destination. Tests populated the outbox directly, hiding that a project with `hubSyncEnabled=true` and a healthy Node could register while all managed CLI and remote-provider events remained local.

Making every producer read Node configuration would couple local execution to a Hub and duplicate destination policy across Codex, Claude, knowledge commands, and future producers. Because the Hub accepts only a contiguous project chain as complete, enqueuing future events without the earlier local prefix could also leave its cursor permanently behind.

## Decision

After authenticated project registration and before claiming leases, `@lervo/sync` reconciles the authoritative local event chain with the Node's configured destination:

1. If the Hub cursor is nonzero, read the local event at that exact sequence and require the same event hash. A missing or different coordinate fails closed with `outbox_update_failed`.
2. Read at most the configured batch limit of local events after the authenticated Hub cursor.
3. In one synchronous transaction, idempotently enqueue every event for that destination.
4. Claim and transmit through the existing lease-bound worker. A synchronized loop continues immediately, advancing long chains in bounded batches.

`hubSyncEnabled=false` still prevents Node startup. Node configuration remains the sole device-local source of Hub URL, credentials, destination ID, and expected Hub identity. The local CLI and provider adapters neither read that configuration nor wait for reconciliation, registration, or delivery.

The cycle result adds `enqueuedCount`, the number of new destination rows created during that cycle. It contains no event IDs, paths, payloads, repository coordinates, endpoint, credentials, or identities. `registration_deferred` always reports zero because no authenticated Hub cursor was accepted. Reconciliation emits no event and therefore cannot recursively create sync work.

## Failure semantics

- Store read, transaction, or enqueue failure becomes `outbox_update_failed` and terminates the Node sync runtime through its existing `sync_runtime_failed` boundary.
- A Hub cursor that differs from local truth is neither repaired nor overwritten automatically.
- Hub unavailability occurs before reconciliation, leaves the local chain unchanged, and retries discovery after the next successful registration.
- Existing outbox rows remain idempotent. Reconciliation never mutates or deletes the local event chain.

## Consequences

Any local producer remains Hub-independent while a configured Node eventually discovers its sanitized events. Restart repairs the prior production gap without a one-off migration, and a new destination can receive the complete allowed local prefix. This does not synchronize CAS bodies or repository files; registration or readiness alone still proves no delivery.

Fixtures cover an empty outbox, 205 events reconciled as 100/100/5, existing outbox gaps, registration failure, and Hub/local cursor conflict. The WSL Hub acceptance pilot verifies the same path with an actual repository and OS service.

## References

- [ADR-0003](../../operations/storage/0003-local-event-store-and-cas.md)
- [ADR-0035](0035-outbound-sync-worker.md)
- [ADR-0151](0151-restartable-node-outbound-sync-runtime.md)
