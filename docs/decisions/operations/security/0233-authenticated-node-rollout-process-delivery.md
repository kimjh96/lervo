# ADR-0233: Authenticated Node Rollout Process Delivery

Status: accepted
Date: 2026-08-27

## Context

The approved Node rollout transaction accepted exact organization records programmatically, but an installed unattended caller lacked authenticated process input and a durable replay fence. Retrying an approval after a lost response could invoke the local transaction twice. Reusing a generic model-provider remote command would mix deployment authority with managed-run policy.

No Hub rollout endpoint or external organization controller is selected. The first installed boundary must remain local, explicit, and independently replaceable without Hub connectivity.

## Decision

Add a dedicated signed `OrganizationNodeRolloutDelivery` envelope and secret-free `OrganizationNodeRolloutDeliveryReceipt`. The installed command is:

```text
lervo repository node rollout execute ... --request <absolute-path> --trust <absolute-path> --write
```

The request, trust manifest, and referenced Ed25519 public-key files must be bounded owner-only files. The process derives the current project identity from the repository manifest and binds the request to the configured Node, destination, repository, service manager, configuration, and executable. The request contains the signed organization policy, exact rollout plan and approval, optional prior observation, enrollment, and exact local execution plan.

Two independently scoped signatures are required:

- The policy signature key must be trusted for its organization and exact project identity.
- The delivery signature key must be trusted for the same organization and project, and its configured principal must equal `approval.approvedBy`.

The approval signature covers the complete delivery, including its policy, approval, target, Node, destination, nonce, idempotency key, validity interval, and exact execution plan. New requests are accepted for at most fifteen minutes with at most sixty seconds of configured clock skew. A completed duplicate may return its stored receipt after expiry because it cannot create another effect, but signatures and installed target bindings must still be revalidated.

Add a target-bound SQLite replay adapter whose immutable metadata binds one project ID and identity hash, Node, and destination. It accepts at most 100,000 configured records and defaults to 1,024. Before local apply, the receiver atomically reserves the delivery hash, idempotency key, and nonce. Its states are:

- `available`: no matching coordinate exists.
- `in_progress`: a durable reservation exists without a completed receipt.
- `completed`: the exact bounded receipt is stored and may be returned idempotently.
- Idempotency or nonce conflict: a coordinate was reused for different content and is rejected.

The receiver recalculates the exact current local plan before reservation, then invokes the existing one-Node local transaction. If apply throws, the process stops and leaves `in_progress`; it does not infer that no effect occurred. If apply succeeds but receipt persistence fails, it reports persistence failure and permits no automatic rerun. Either uncertain state is resolved through [ADR-0234](0234-bounded-node-rollout-effect-recovery.md), which inspects exact installed state without replay.

This local boundary invokes an installed CLI over owner-only files. It is not a Hub endpoint, Node daemon transport, delivery authoring interface, multi-Node transaction, or automatic recovery mechanism. It adds no provider dependency and does not reuse managed model-run commands.

## State, Privacy, and Failure Meaning

The signed delivery has `deployment: not_executed` and `rollback: not_executed`. A completed delivery receipt has `deployment: executed` and `rollback: not_executed` and embeds the existing secret-free one-Node execution receipt. Neither record contains bearer material, key bytes, file paths, service definitions, repository bodies, or unrestricted provider output. Both declare `secretMaterial: excluded`.

The SQLite database stores target identity metadata, delivery hash, idempotency key, nonce, an opaque reservation ID, and an optional bounded receipt. ADR-0234 extends unresolved records with path-free baseline and current recovery projections. This is local durable state under `.lervo/data` by default, not canonical documentation or a rebuildable projection. Records are not automatically deleted; capacity exhaustion fails closed.

- `invalid_node_rollout_delivery`: the contract, installed binding, time bounds, or recalculated local plan did not match.
- `invalid_node_rollout_delivery_signature`: a signature contract or cryptographic verification failed.
- `node_rollout_delivery_signer_denied`: the key or approval principal was not trusted for the exact organization and project.
- `node_rollout_delivery_trust_failed`: trusted signer lookup failed.
- `node_rollout_delivery_not_current`: a new request was outside its accepted interval.
- `node_rollout_delivery_replay_rejected`: an idempotency key or nonce conflicted with prior content.
- `node_rollout_delivery_in_progress`: a prior invocation has an unresolved possible effect and must not be replayed automatically.
- `node_rollout_delivery_persistence_failed`: replay state could not be read, reserved, or completed; after apply, it explicitly permits an uncertain effect.

No new event exists. The receipt is proven only by the local replay database. Publishing rollout delivery or recovery events requires a later decision defining exact allowlisted fields, privacy handling, retention, and projector semantics.

## Consequences

An installed operator or future controller can deliver one exact approved Node transaction with authenticated authorship and durable at-most-once invocation fencing. A completed retry returns the same receipt across process restarts. Conflicts and unresolved attempts fail closed.

Automatic retry is unavailable after an uncertain apply. Bounded recovery compares the reserved execution baseline with exact current local state and classifies it as applied, not applied, or unknown without guessing. [ADR-0235](0235-predecessor-bound-node-rollout-rollback.md) adds predecessor-bound local rollback behind a separate programmatic port; authenticated rollback delivery and installed multi-device acceptance remain later boundaries.

## Verification

Schema tests validate signed delivery and receipt shapes. Contract tests cover valid two-signature execution, exact duplicate replay, approval-principal mismatch, and unresolved apply failure without a second mutation. SQLite tests cover durable reservation and completion across reopen, bounded capacity, and target mismatch. Installed composition tests cover owner-only request, trust, and key files; manifest-derived project binding; trusted-principal enforcement; replay-store closure; and one local apply.

## References

- [Approved Node rollout local transaction](0232-approved-node-rollout-local-transaction.md)
- [Organization Node enrollment and gradual rollout](0229-organization-node-enrollment-and-gradual-rollout.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Organization Node fleet rollout](../../../roadmap/operations/organization-node-fleet-rollout.md)
- [Predecessor-bound Node rollout rollback](0235-predecessor-bound-node-rollout-rollback.md)
