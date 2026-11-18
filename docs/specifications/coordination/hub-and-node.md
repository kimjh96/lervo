# Hub and Node coordination specification

Status: `active`
As of: 2026-08-26

## Contracts

- [Authentication and authority](hub-and-node/authentication.md): remote execution.
- [Event streams](hub-and-node/event-streams.md): destination chains and reader compatibility.
- [Repository workstreams](hub-and-node/workstreams.md): replication, divergence, and permissions.
- [Agent workspace coordination](hub-and-node/agent-workspaces.md): reservations, lifecycle summaries, and local authority.
- [Capability packages](hub-and-node/capability-packages.md): optional publication and content validation.
- [Runtime lifecycle](hub-and-node/runtime-lifecycle.md): health, service stabilization, upgrades, and bounded offline replacement.

## Idle reconciliation

[Node idle reconciliation](node-idle-reconciliation.md) defines authenticated change hints, local WAL wakeups, bounded incremental workstream verification, full-audit detection windows, and legacy polling fallback. Hints grant no authority; local operation remains independent of the Hub.

## References

- Organization deployment policy, runtime credential delivery, and signed Node fleet rollout (ADR-0228 to ADR-0236) were removed by [ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md); `lervo upgrade` owns the Node stage.
- Event readers: [ADR-0332](../../decisions/operations/trace/0332-authoritative-distributed-event-reader-inventory.md).
- [Planned agent workspace specification](../execution/agent-workspaces.md).
- [Execution and evidence specification](../execution.md).
- [Repository-scoped workstream replication](../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md).
- [Destination-bound event reconciliation](../../decisions/coordination/sync/0194-destination-bound-local-event-reconciliation.md).
- [Node remote control](../../decisions/coordination/remote-control/0152-fail-closed-node-remote-control-runtime.md).
- [Local-first capability package supply chain](../../decisions/execution/orchestration/0210-local-first-capability-package-supply-chain.md).
- [Isolated agent workspace lifecycle](../../decisions/execution/orchestration/0222-isolated-agent-workspace-lifecycle.md).
