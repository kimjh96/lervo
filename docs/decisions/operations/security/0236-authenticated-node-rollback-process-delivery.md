# ADR-0236: Authenticated Node rollback process delivery

Status: accepted
Date: 2026-08-27

## Context

The predecessor-bound rollback transaction was available only through an in-process port. It lacked authenticated file delivery, a process command, durable replay fencing, and recovery after an uncertain local effect. Retrying after a lost response could therefore invoke service rollback twice.

Forward rollout delivery already provides owner-only request and trust files, independently scoped Ed25519 policy and approval signatures, exact installed-target validation, and bounded SQLite replay. Rollback must reuse these controls without representing a rollback receipt as a forward deployment effect.

## Decision

Add distinct signed `OrganizationNodeRollbackDelivery`, completed delivery receipt, and recovery receipt records. Install these commands:

```text
lervo repository node rollout rollback ... --failed-executable <absolute-path> --predecessor-executable <absolute-path> --request <absolute-path> --trust <absolute-path> --write
lervo repository node rollout rollback-recover ... --failed-executable <absolute-path> --predecessor-executable <absolute-path> --request <absolute-path> --trust <absolute-path> --write
```

The signed request binds the signed organization policy, exact `rollback_wave` approval and failed observation, enrollment, predecessor-bound rollback plan, project identity, Node, destination, validity interval, nonce, and idempotency key. Policy and approval keys use the same owner-only trust manifest and project-scoped Ed25519 verification as forward rollout. The approval signer principal must equal the recorded approver.

Add an immutable `organization_rollback_replay` SQLite table to the existing target-bound database. Before rollback, the receiver re-creates the exact current rollback plan, records a path-free local recovery baseline, and atomically reserves the delivery hash, idempotency key, and nonce. A completed duplicate returns the stored rollback delivery receipt. A conflicting coordinate or unresolved reservation fails closed and never invokes rollback again.

The installed rollback adapter may inspect predecessor disposition without mutation. Recovery compares the reserved baseline with the exact current predecessor plan, registry reconciliation, service-definition disposition, and legacy target. It classifies the result as `rolled_back`, `not_rolled_back`, or `unknown`, persists one bounded current projection, and never invokes rollback or synthesizes a completed rollback receipt. Terminal classifications are returned idempotently; later inspection may replace `unknown`.

Forward and rollback replay tables share target metadata but keep coordinates, effects, receipts, and recovery classifications separate. Existing forward schemas migrate transactionally to schema version 3 by adding the rollback table without rewriting forward records.

## State, privacy, and failure meaning

Delivery records `deployment: not_executed` and `rollback: not_executed`. Its completed receipt embeds the predecessor-bound rollback receipt and records `deployment: not_executed` and `rollback: executed`. Recovery records both effects as `not_executed` because inspection does not replay mutation.

Requests, receipts, baselines, and durable rows exclude absolute paths, executable bytes, service definitions, credentials, key material, native output, and unrestricted errors. Every public record declares `secretMaterial: excluded`. No event or Hub store is added.

- `invalid_node_rollback_delivery`: the request, installed binding, interval, or recalculated rollback plan differs.
- `invalid_node_rollback_delivery_signature`: the signed envelope or cryptographic signature is invalid.
- `node_rollback_delivery_not_current`: a new request is outside its accepted interval.
- `node_rollback_delivery_replay_rejected`: an idempotency key or nonce conflicts with durable state.
- `node_rollback_delivery_in_progress`: a prior invocation has an unresolved possible effect and cannot be replayed.
- `node_rollback_delivery_persistence_failed`: reservation, completion, or recovery state could not be persisted; after local rollback, this permits an uncertain effect.
- `invalid_node_rollback_recovery_receipt`: bounded recovery evidence or identity is invalid.
- `node_rollback_recovery_unavailable`: no matching baseline-capable unresolved reservation exists.
- `node_rollback_recovery_failed`: exact current inspection failed without producing a classification.

## Consequences

An installed operator can deliver one authenticated rollback with durable at-most-once invocation fencing. A lost response does not authorize retry: inspection resolves proven predecessor state, while ambiguous state remains fenced.

The boundary remains one Node-scoped local process. It is not a Hub endpoint, Node daemon transport, automatic failure selection, multi-Node transaction, cross-Node atomicity, or authorization for unattended fleet-wide rollback. Unattended automation requires an explicitly selected controller and operating policy.

## Verification

Schema type tests distinguish rollback delivery effects from recovery effects. Contract and SQLite integration tests cover scoped signatures, exact rollback-plan revalidation, completed duplicate return across reopen, uncertain-effect fencing, terminal recovery persistence, and absence of a second rollback invocation. CLI build and command-parsing tests cover the distinct rollback executable bindings.

## References

- [Predecessor-bound Node rollout rollback](0235-predecessor-bound-node-rollout-rollback.md)
- [Authenticated Node rollout process delivery](0233-authenticated-node-rollout-process-delivery.md)
- [Bounded Node rollout effect recovery](0234-bounded-node-rollout-effect-recovery.md)
- [Organization Node fleet rollout](../../../roadmap/operations/organization-node-fleet-rollout.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
