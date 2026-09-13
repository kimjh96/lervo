# Hub and Node coordination specification

Status: `active`
As of: 2026-08-26

## Contracts

- [Authentication and authority](hub-and-node/authentication.md): remote execution, organization policy, and credential delivery.
- [Organization fleet rollout](hub-and-node/fleet-rollout.md): enrollment, waves, local execution, recovery, and rollback.
- [Event streams](hub-and-node/event-streams.md): destination chains and reader compatibility.
- [Repository workstreams](hub-and-node/workstreams.md): replication, divergence, and permissions.
- [Agent workspace coordination](hub-and-node/agent-workspaces.md): reservations, lifecycle summaries, and local authority.
- [Capability packages](hub-and-node/capability-packages.md): optional publication and content validation.
- [Runtime lifecycle](hub-and-node/runtime-lifecycle.md): health, service stabilization, upgrades, and bounded offline replacement.

## Idle reconciliation

[Node idle reconciliation](node-idle-reconciliation.md) defines authenticated change hints, local WAL wakeups, bounded incremental workstream verification, full-audit detection windows, and legacy polling fallback. Hints grant no authority; local operation remains independent of the Hub.

## References

- Authentication: [ADR-0228](../../decisions/operations/security/0228-organization-deployment-policy-and-runtime-credentials.md), [ADR-0230](../../decisions/operations/security/0230-owner-only-file-organization-credential-source.md), [ADR-0231](../../decisions/operations/security/0231-authenticated-node-organization-credential-activation.md).
- Fleet rollout: [ADR-0229](../../decisions/operations/security/0229-organization-node-enrollment-and-gradual-rollout.md), [ADR-0232](../../decisions/operations/security/0232-approved-node-rollout-local-transaction.md), [ADR-0233](../../decisions/operations/security/0233-authenticated-node-rollout-process-delivery.md), [ADR-0234](../../decisions/operations/security/0234-bounded-node-rollout-effect-recovery.md), [ADR-0235](../../decisions/operations/security/0235-predecessor-bound-node-rollout-rollback.md), [ADR-0236](../../decisions/operations/security/0236-authenticated-node-rollback-process-delivery.md), and [three-Node acceptance evidence](../../evidence/operations/organization-node-multi-device-rollout-v1.md).
- Event readers: [ADR-0332](../../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md).
- [Planned agent workspace specification](../execution/agent-workspaces.md).
- [Execution and evidence specification](../execution.md).
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
- [Destination-bound event reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md).
- [Node remote control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md).
- [Local-first capability package supply chain](../../decisions/execution/orchestration/0210-local-first-capability-package-supply-chain.md).
- [Isolated agent workspace lifecycle](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md).
