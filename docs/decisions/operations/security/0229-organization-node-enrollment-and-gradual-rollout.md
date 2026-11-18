# ADR-0229: Organization Node Enrollment and Gradual Rollout

Status: superseded
Date: 2026-08-27

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

Repository Node apply owns content-bound service installation, transactional upgrade and rollback, registry commit, and three consecutive readiness observations. Organization deployment policy owns project tenancy and runtime credential authority. Neither contract binds a locally ready Node to an organization or prevents changing every Node at once.

The organization layer must not duplicate local service mutation, infer readiness from installation, accept offline readiness for initial admission, or treat approval as execution. It remains independent of Hub topology, secret manager, operating system, and provider.

## Decision

Add `rollout.execute` and `rollout.rollback` to organization deployment permissions while keeping `deployment.plan`, `node.enroll`, and `rollout.approve` separate. A rollout plan is valid only when its project has an approver distinct from its executor and rollback operator. The planner cannot approve the same plan; the approver cannot execute or roll back the approved action.

An `OrganizationNodeEnrollment` binds:

- the policy ID and hash derived from the signed policy;
- the strict project target, Node, and destination;
- the deterministic repository service instance;
- the runtime version and artifact hash;
- the runtime credential grant and delivery receipt;
- the local onboarding plan ID and local apply receipt hash;
- complete readiness.

Initial organization admission requires exactly three ready observations with event sync and workstream replication ready. Workspace coordination and remote control may be ready or explicitly disabled. `offline_ready`, pending, degraded, unavailable, or stale evidence cannot enroll a Node. Effective credential revocation also blocks enrollment. Enrollment records exclude repository paths, service bodies, credential sources, and secret material.

An `OrganizationFleetRolloutPlan` binds one exact enrolled fleet, target runtime version and artifact hash, ordered waves, and fixed health and failure gates. Every enrollment appears exactly once. Fleets larger than one Node begin with a one-Node canary. Each later wave contains at most twice as many Nodes as its predecessor and no more than 32 Nodes. The plan records `deployment: not_executed`, `rollback: not_executed`, and `approval: not_granted`.

An `OrganizationFleetWaveObservation` binds the exact plan hash and wave, one result for every selected enrollment, observed runtime and artifact, component readiness, observer, and time. Evaluation is deterministic:

- Exact target version and artifact plus at least three complete ready observations for every target produces `ready_to_advance`.
- Pending or insufficient observations produce `hold`.
- Any degraded, unavailable, or stale Node, or a target version or artifact mismatch, produces `rollback_required`.

Evaluation selects no action. The first canary requires explicit `execute_wave` approval. Each later execution approval requires the exact preceding wave's `ready_to_advance` observation. A `rollback_wave` approval requires the exact current wave's `rollback_required` observation. Every approval is content-addressed and records `approval: granted` while both deployment effects remain `not_executed`. Before acting, an adapter revalidates the policy, plan, approval, exact observation when required, time, action-specific executor permission, and approver/executor separation.

Existing local Node apply remains the only service mutator. [ADR-0232](0232-approved-node-rollout-local-transaction.md) adds the first Node-scoped `execute_wave` binding to an exact local plan and apply receipt. It adds no rollout store, authenticated process transport, Hub API, rollback mutator, or Lervo event; those require bounded recovery before unattended execution.

## State, Privacy, and Failure Meaning

| Record | Required coordinates | Meaning and privacy |
| --- | --- | --- |
| `OrganizationNodeEnrollment` | Policy, project, Node, destination, service instance, runtime artifact, credential delivery, local plan and receipt hashes, readiness | Organization admission from exact reported evidence; paths, bodies, sources, and secrets excluded |
| `OrganizationFleetRolloutPlan` | Policy, enrolled fleet, target version and artifact, ordered waves, health gate, planner and time | Immutable proposal; no approval or deployment effect |
| `OrganizationFleetWaveObservation` | Plan hash, wave, exact Node results, observer and time | Bounded observation; selects no decision or action |
| `OrganizationFleetRolloutApproval` | Plan hash, wave, action, exact observation when required, approver and time | Approval only; no execution or rollback claim |

This decision adds no durable state or event. If these records are persisted, their owner must define bounded retention, authenticated authorship, event names and allowlisted fields, conflict handling, and interrupted-operation recovery. Ordinary records must continue to exclude absolute paths, service bodies, bearer values, credential locations, provider output, and unrestricted errors.

Failures are fail closed:

- `invalid_node_enrollment`: credential delivery, service identity, local evidence, or complete online readiness was not established.
- `invalid_fleet_rollout_plan`: tenancy, enrolled fleet, exact coverage, canary, wave growth, policy binding, or split authority was invalid.
- `invalid_fleet_wave_observation`: the observation did not bind every exact target in the selected wave.
- `fleet_wave_gate_not_satisfied`: prior readiness or current failure evidence did not authorize the requested action.
- `invalid_fleet_rollout_approval`: approval identity, evidence coordinates, or effect semantics were invalid.
- `organization_authority_denied`: the planner, approver, executor, rollback operator, project, time, or separation of duties was unauthorized.

## Consequences

Organization fleet rollout gains a deterministic safety contract over the proven local Node lifecycle. A canary failure cannot silently advance, and rollback remains separately approved. Content-addressed approvals authorize actions but do not prove that a service changed or remained healthy.

Installed organization acceptance, durable coordination, and an authenticated rollout API remain separate work. ADR-0230 provides a local owner-only file bootstrap source, ADR-0231 composes authenticated credential activation, and ADR-0232 binds one approved Node deployment to the existing local transaction. No external organization secret authority is selected. Local-only execution and existing repository Node reconciliation remain unchanged.

## Verification

Contract tests cover active credential and delivery binding, deterministic service identity, revocation and readiness rejection, secret exclusion, exact fleet coverage, one-Node canary, bounded wave growth, ready, hold, and rollback gates, prior-wave evidence, approval effects, and planner, approver, executor, and rollback separation. Schema type tests keep enrollment evidence, observations, approvals, and effects distinct.

## References

- [Organization deployment policy and runtime credentials](0228-organization-deployment-policy-and-runtime-credentials.md)
- [Repository Node fleet identity](../services/0202-repository-node-fleet-identity-and-registry.md)
- [Transactional repository Node apply](../services/0207-transactional-repository-node-apply-and-readiness.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
- [Owner-only file organization credential source](0230-owner-only-file-organization-credential-source.md)
- [Approved Node rollout local transaction](0232-approved-node-rollout-local-transaction.md)
