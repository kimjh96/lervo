# Organization Node fleet enrollment and gradual rollout

Status: `complete`
As of: 2026-08-27
Completed: 2026-08-27

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed organization Node enrollment, wave rollout, signed rollout and rollback delivery, and `lervo repository node rollout`. `lervo upgrade` owns the Node stage. The records below are history.

## Problem

Repository Node installation and readiness were transactional, and organization policy separated deployment and credential authority, but no exact contract admitted local Nodes into an organization fleet or gated cross-Node rollout.

## Product outcome

An organization can bind a locally ready Node to its signed policy and delivered runtime credential without recording secrets or paths. Fleet changes begin with one canary, expand by at most twofold per wave, advance only from exact complete readiness, and require separate approval and execution authority. Failure holds rollout and requires explicit rollback approval.

Local execution and repository Node reconciliation remain independent of this organization layer.

## Completed scope

1. Added schema-derived Node enrollment, fleet rollout plan, wave observation, and rollout approval records.
2. Bound enrollment to strict project identity, deterministic service instance, runtime artifact, credential grant and delivery receipt, and local plan and apply receipt hashes.
3. Required three complete online readiness observations; effective credential revocation and offline, pending, degraded, unavailable, or stale admission evidence are rejected.
4. Required exact enrollment coverage, a one-Node canary for multi-Node fleets, at most twofold wave growth, and a 32-Node wave maximum.
5. Added deterministic `ready_to_advance`, `hold`, and `rollback_required` evaluation without selecting an action.
6. Required exact prior-wave readiness for later execution and exact current-wave failure for rollback approval.
7. Separated planner, approver, executor, and action-specific rollback authority; approval records explicitly claim no deployment effect.
8. Kept existing local Node apply as the sole service-mutation boundary.
9. Added one-Node execution plans and receipts binding the exact `execute_wave` approval, wave membership, executor authority, runtime artifact, and current local plan ID and hash.
10. Composed the installed CLI boundary with the existing local apply transaction and required complete online readiness before producing a secret-free Node execution receipt.
11. Added an owner-only installed CLI delivery boundary with scoped policy and approver signatures, exact local-target revalidation, and bounded durable SQLite replay fencing.
12. Added bounded `in_progress` recovery that persists the pre-apply projection, replans exact local state, classifies `applied`, `not_applied`, or `unknown`, and never replays apply.
13. Added one-Node rollback plans and receipts binding the exact failed observation and rollout artifact to the distinct predecessor version, artifact, and current local plan.
14. Added an installed rollback adapter that invokes the explicit service rollback action, requires complete predecessor readiness before registry commit, and compensates to the failed target after a pre-commit failure.
15. Ran a three-Node installed composition acceptance covering one canary, deterministic twofold expansion, incomplete-evidence hold, canonical observation ordering, and predecessor rollback of only the degraded Node.
16. Added signed installed rollback delivery with exact target revalidation, a separate durable at-most-once replay table, and non-mutating `rolled_back`, `not_rolled_back`, or `unknown` recovery.

## Acceptance

- Enrollment requires one active delivered grant matching the exact project, Node, destination, service identity, and complete readiness evidence.
- Enrollment, plan, observation, and approval records contain no bearer value, credential source, absolute path, service definition, or provider output.
- Every enrolled Node appears in exactly one wave. A multi-Node rollout begins with one canary and grows by at most twofold.
- Incomplete readiness holds rollout. Mismatch or degraded health requires rollback. Only exact complete readiness permits the next wave.
- Wave one and every later wave require explicit approval; later waves bind the exact previous observation.
- Rollback binds the exact current failed observation.
- The planner cannot approve, the approver cannot execute, and execution revalidates the action-specific policy permission.
- Plans, observations, and approvals never claim that deployment or rollback occurred.
- A Node execution plan rechecks the exact local plan before mutation. Its receipt proves only that Node's local transaction and complete online readiness.
- Another wave member, local-plan drift, artifact mismatch, offline readiness, or rollback approval prevents a successful execution receipt.
- A signed delivery must match its trusted approval principal and exact installed target. A completed retry returns the same receipt; a conflict or unresolved prior attempt cannot invoke apply again.
- Recovery requires the same authenticated request and target, excludes paths and secrets, persists only one bounded current projection, and leaves the original execution reservation fenced.
- Rollback requires an exact degraded, unavailable, or stale observation of the rollout target and a distinct enrollment-bound predecessor artifact.
- The installed rollback adapter rejects registry, service-definition, artifact, predecessor, legacy-service, or local-plan drift before mutation. Its receipt proves only one Node's complete predecessor apply.
- The installed multi-device acceptance proves independent per-Node applies, wave-level advancement only from complete canonical observation, hold without rollback authority, and rollback effect only for the exact degraded Node.
- Authenticated rollback delivery requires scoped policy and approver signatures, reserves before mutation, returns completed duplicates, and keeps unresolved effects fenced while recovery inspects only exact predecessor state.

## Deferred scope

- An external organization credential source after its authority is selected.
- Durable organization enrollment, observation, and approval storage with bounded retention and events.
- Unattended cross-version automation and any cross-Node transaction or atomicity claim.

## References

- [ADR-0229](../../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md)
- [ADR-0232](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md)
- [ADR-0233](../../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md)
- [ADR-0234](../../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md)
- [ADR-0235](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md)
- [ADR-0236](../../decisions/operations/security/0236-authenticated-node-rollback-process-delivery.md)
- [Installed multi-device acceptance](../../evidence/operations/organization-node-multi-device-rollout-v1.md)
- [Organization deployment policy and runtime credentials](organization-deployment-policy.md)
- [Repository Node fleet](../coordination/repository-node-fleet.md)
- [Organization runtime credential sources](organization-runtime-credential-sources.md)
