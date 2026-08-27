# ADR-0234: Bounded Node Rollout Effect Recovery

Status: accepted
Date: 2026-08-27

## Context

Authenticated rollout delivery reserves replay coordinates before local mutation. A process failure during apply, or after apply but before receipt persistence, leaves `in_progress` and blocks replay. An exception does not prove that no effect occurred, so operators need a way to inspect the uncertain state.

## Decision

Add `lervo repository node rollout recover` with the same owner-only signed request, scoped trust, installed target, executable, configuration, and replay-store bindings as execution. Recovery revalidates both signatures and the current project identity. Delivery expiry does not prevent inspection of an existing reservation because recovery cannot invoke apply.

Before reserving execution, persist a bounded, path-free recovery baseline beside the replay coordinate. It contains the local plan ID and hash, registry reconciliation, exact desired-service disposition, legacy-service disposition, and explicit privacy exclusions. The installed adapter defines `desired` only when the current service-definition hash equals the definition rendered from the bound executable and configuration; file presence is insufficient.

Recovery replans current local state and classifies it as:

- `not_applied` only when the exact local plan ID and hash remain at a baseline that was not already desired.
- `applied` only when state changed, the registry remains at the desired coordinates, the exact desired service definition is installed, and the legacy singleton is absent.
- `unknown` when the baseline was already desired, state conflicts, partial or unrelated drift exists, or neither proof rule is satisfied.

Recovery never calls local apply. It records one bounded current recovery receipt per reservation. A later inspection may replace `unknown`; `applied` and `not_applied` are terminal and returned idempotently. The original reservation remains fenced, and no execution receipt is synthesized. SQLite schema version 2 preserves version-1 reservations, but older rows lack a baseline and fail recovery closed.

## State, Privacy, and Failure Meaning

`OrganizationNodeRolloutRecoveryReceipt` records delivery, execution-plan, target, Node, destination, inspection time, baseline, current observation, and classification. It declares `deployment: not_executed`, `rollback: not_executed`, and `secretMaterial: excluded` because inspection causes no rollout effect. It excludes absolute paths, credentials, service bodies, key material, health bodies, and unrestricted errors.

The replay database retains the latest bounded recovery projection for the reservation's lifetime, subject to the existing fixed record capacity. Recovery emits no new event and has no Hub dependency.

- `invalid_node_rollout_recovery_receipt`: recovery evidence or its content identity is invalid.
- `node_rollout_recovery_unavailable`: no matching unresolved reservation, baseline-capable adapter, or recovery-capable store exists.
- `node_rollout_recovery_failed`: exact current local inspection failed and no classification was persisted.
- `node_rollout_delivery_persistence_failed`: recovery state or receipt persistence failed.

## Consequences

After an uncertain delivery, an operator can distinguish a proven unchanged target from a proven desired installed target while preserving the at-most-once fence. Ambiguous state remains explicit and retryable only as inspection. Recovery does not prove which process caused the current state, current runtime readiness, wave advancement, or rollback safety.

[ADR-0235](0235-predecessor-bound-node-rollout-rollback.md) adds predecessor-bound local rollback without weakening this fence. Authenticated rollback delivery and installed multi-device acceptance remain separate work.

## Verification

Schema and contract tests cover all three classifications and content-bound receipts. SQLite tests cover durable baseline and terminal recovery persistence. Installed composition tests prove that recovery uses the authenticated request and current local observation without calling apply.

## References

- [Authenticated Node rollout process delivery](0233-authenticated-node-rollout-process-delivery.md)
- [Approved Node rollout local transaction](0232-approved-node-rollout-local-transaction.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Organization Node fleet rollout](../../../roadmap/operations/organization-node-fleet-rollout.md)
- [Predecessor-bound Node rollout rollback](0235-predecessor-bound-node-rollout-rollback.md)
