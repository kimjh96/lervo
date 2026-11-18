# ADR-0232: Approved Node Rollout Local Transaction

Status: superseded
Date: 2026-08-27

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Organization rollout approval authorizes one wave action but claims no service effect. The repository Node lifecycle already owns exact local planning, transactional installation or upgrade, compensation, three complete readiness observations, and registry commit. No contract joined these boundaries without treating approval as execution or allowing a coordinator to create a partially applied multi-Node transaction.

The rollout target includes an exact runtime artifact hash, while the local Node plan identifies service and registry state. Execution must bind both before mutation. One Node's success does not imply successful execution, advancement, or rollback for its wave or any later wave.

## Decision

Add schema-derived `OrganizationNodeRolloutExecutionPlan` and `OrganizationNodeRolloutExecutionReceipt` records. Each execution plan covers exactly one enrolled Node in one approved `execute_wave` action. Before requesting a local plan, the organization contract revalidates:

- the policy, rollout plan, exact approval, and prior-wave observation when required;
- executor authority and separation of approval from execution;
- wave membership, project identity, Node, destination, runtime version, and artifact hash.

The local transaction port returns the exact local plan ID and canonical plan hash with the Node, destination, project identity, target version, and target artifact. Apply revalidates organization authority and every binding, obtains the current local plan again, and refuses mutation if its ID or hash changed.

The installed CLI composition verifies its physical repository root, explicit organization Node configuration, Hub destination, and executable bytes before producing local plan evidence. It invokes the existing `applyNodeFleetOnboarding` transaction with that exact executable and configuration. Only a receipt containing three complete online readiness observations is accepted. The organization receipt retains only content hashes and bounded coordinates; it excludes local paths, service bodies, credentials, and native output.

Execution remains Node-scoped. Every Node in an approved wave performs its own exact transaction. The existing complete wave observation then determines `ready_to_advance`, `hold`, or `rollback_required`. A Node receipt neither authorizes nor proves another Node's mutation.

This adapter rejects `rollback_wave`. The current rollout plan names the failed target but does not bind the exact predecessor artifact and local rollback plan required for safe explicit rollback. [ADR-0235](0235-predecessor-bound-node-rollout-rollback.md) subsequently adds that separate contract and local adapter without changing this forward-execution port.

This decision adds no CLI command, process delivery transport, Hub endpoint, durable state, or event. [ADR-0233](0233-authenticated-node-rollout-process-delivery.md) subsequently adds an authenticated installed CLI process boundary and durable replay fence. Local apply retains its compensation and failure semantics, and loss of a response remains an uncertain effect until recovery inspects exact local state.

## State, Privacy, and Failure Meaning

An execution plan has `deployment: not_executed` and `rollback: not_executed`. A successful receipt has `deployment: executed` and `rollback: not_executed`, proving only that the exact local apply transaction for one Node returned complete online readiness. It does not prove wave health, observation, advancement, later continuity, credential use, or rollback.

Neither record contains an absolute path, repository body, service definition, bearer value, credential source, approval transport token, or unrestricted failure. Both declare `secretMaterial: excluded`.

- `invalid_node_rollout_execution_plan` means the organization, wave, Node, target artifact, authority, or exact current local plan binding did not match.
- `invalid_node_rollout_execution_receipt` means the local apply evidence did not match the exact execution plan or complete online readiness contract.
- `node_rollout_execution_failed` means local planning or apply did not return bounded successful evidence. It does not prove that a future remote effect did not occur.

No new event exists. Before persisting execution plans, receipts, approvals, or recovery status, the owner must define bounded retention, authenticated authorship, replay rules, event names and allowlisted fields, and interrupted-operation recovery.

## Consequences

An approved canary or later wave can be reduced to independent, exact local Node transactions without weakening the existing wave gate. The wrapper binds runtime artifact bytes, not only the semantic version, to local planning and apply. Stale local state fails before service mutation.

Authenticated process delivery and bounded completed-receipt persistence are specified by ADR-0233. Uncertain-effect recovery is specified by ADR-0234, and separate predecessor-bound rollback is specified by ADR-0235. Authenticated rollback delivery and installed multi-device acceptance remain separate work. The local forward transaction composition remains infrastructure under the authenticated receiver.

## Verification

Contract tests cover one exact approved wave member, authority revalidation, secret-free plan and receipt effects, local-plan drift before apply, rejection of another wave member, and rejection of rollback approval before local planning. Installed composition tests bind the executable hash, organization Node configuration, repository identity, destination, existing local plan, online readiness, and hashed local apply receipt. Schema type tests keep proposed and executed effects distinct.

## References

- [Organization Node enrollment and gradual rollout](0229-organization-node-enrollment-and-gradual-rollout.md)
- [Authenticated Node credential activation](0231-authenticated-node-organization-credential-activation.md)
- [Authenticated Node rollout process delivery](0233-authenticated-node-rollout-process-delivery.md)
- [Predecessor-bound Node rollout rollback](0235-predecessor-bound-node-rollout-rollback.md)
- [Transactional repository Node apply](../services/0207-transactional-repository-node-apply-and-readiness.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
