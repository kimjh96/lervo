# ADR-0235: Predecessor-Bound Node Rollout Rollback

Status: superseded
Date: 2026-08-27

Superseded by [ADR-0560](../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md). Lervo no longer ships this capability.

## Context

An explicit `rollback_wave` approval was insufficient because the rollout target did not identify safe predecessor bytes. Treating any older semantic version as the predecessor could select an unrelated artifact, while reusing the forward apply contract would obscure rollback's distinct authority and effect.

## Decision

Add separate `OrganizationNodeRolloutRollbackPlan` and `OrganizationNodeRolloutRollbackReceipt` contracts. A rollback plan covers one enrolled Node in the approved failed wave and binds:

- the exact `rollback_wave` approval and its current failed observation;
- an observed Node running the rollout target version and artifact with degraded, unavailable, or stale readiness;
- the failed version and artifact from the rollout plan;
- the predecessor version and artifact from that Node's enrollment;
- one current local predecessor plan ID and hash; and
- the organization, project identity, Node, destination, executor, and timestamps.

The failed target and predecessor must differ. Planning and apply revalidate rollback authority, wave membership, approval and observation hashes, and every predecessor coordinate. Apply obtains the local plan again and refuses mutation if its ID or hash changed.

Add an installed local rollback adapter that verifies the physical repository and runtime configuration, hashes both executable artifacts, and renders the exact failed service definition. Local state must contain that failed definition, the registry must name the failed runtime version, the predecessor plan must require a registry refresh, and the legacy singleton must be absent.

The local transaction renders both service definitions and invokes the service manager's explicit `rollback` action. It requires three complete online readiness observations before committing the predecessor runtime version to the fleet registry. If readiness or registry persistence fails before commit, it attempts to restore the exact failed definition. Failed compensation reports recovery failure instead of claiming either state.

This is an installed programmatic composition boundary. It does not add signed rollback delivery, a CLI rollback command, Hub or daemon transport, a durable replay fence, automatic rollback selection, a multi-Node transaction, or unattended cross-version automation.

## State, Privacy, and Failure Meaning

The plan records `deployment: not_executed` and `rollback: not_executed`. A successful receipt records `deployment: not_executed` and `rollback: executed`. It proves only that one exact local predecessor transaction returned complete online readiness and committed the predecessor registry coordinates. It does not prove wave health, later continuity, credential use, or successful rollback of another Node.

Both records exclude absolute paths, executable bytes, service definitions, credentials, source coordinates, native command output, and unrestricted errors. Both declare `secretMaterial: excluded`. No event or new durable store is added.

- `invalid_node_rollout_rollback_plan` means authority, failed observation, wave membership, predecessor identity, or the current local plan did not match exactly.
- `invalid_node_rollout_rollback_receipt` means local evidence did not prove the exact predecessor plan and complete effect contract.
- `node_rollout_rollback_failed` means local planning or rollback did not return bounded successful evidence; it does not prove that no local effect occurred.
- `node_fleet_rollback_plan_invalid` means the installed registry or service definition did not match the exact failed target and predecessor.
- `node_fleet_rollback_failed` means the explicit local rollback did not reach complete readiness.
- `node_fleet_recovery_failed` means compensation could not prove restoration of the failed target.

Because this slice has no durable process replay fence, it is not authorized for unattended delivery. A later authenticated rollback receiver must define at-most-once reservation, uncertain-effect recovery, and bounded receipt persistence before exposing a process command.

## Consequences

An approved rollback selects exact predecessor bytes rather than a version label and crosses a distinct rollback port. The local adapter preserves transactional service and readiness guarantees while making the rollback effect explicit. Rollback remains Node-scoped, and the fleet observation gate remains authoritative for the wave.

Installed multi-device acceptance and authenticated rollback process delivery remain separate work.

## Verification

Schema type tests keep rollback planning separate from rollback effect. Contract tests cover exact failed-observation and predecessor binding, successful receipt identity, and local-plan drift before mutation. Installed composition tests bind both artifacts and reject a substituted predecessor. The local adapter test proves that the service manager receives `rollback` and that registry commit follows readiness.

## References

- [Bounded Node rollout effect recovery](0234-bounded-node-rollout-effect-recovery.md)
- [Authenticated Node rollout process delivery](0233-authenticated-node-rollout-process-delivery.md)
- [Approved Node rollout local transaction](0232-approved-node-rollout-local-transaction.md)
- [Organization Node fleet rollout](../../../roadmap/operations/organization-node-fleet-rollout.md)
- [Hub and Node coordination](../../../specifications/coordination/hub-and-node.md)
