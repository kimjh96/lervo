# Idle runtime follow-up

## ADR-0397: idle reconciliation

[ADR-0397](../../../decisions/coordination/sync/0397-event-driven-node-idle-reconciliation.md) separates change notification from durable verification. Source acceptance requires:

- Zero unchanged-head event/CAS reads between audits.
- One verified read per new snapshot.
- Equal-window CPU comparison.
- Cross-process local wakeup.
- Authenticated remote hints.
- Missed-notification recovery.
- Integrity failures under the explicit audit window.

The [idle reconciliation specification](../../../specifications/coordination/node-idle-reconciliation.md) owns exact limits.

The WSL rollout passed separate live-process readiness and equal 60-second CPU observations on 2026-09-11; see the [recorded evidence](../../../evidence/foundation/node-idle-reconciliation-v1.md). The independent Arca burst profile is excluded from this follow-up.

## ADR-0399: change-driven work

[ADR-0399](../../../decisions/coordination/sync/0399-change-driven-repository-and-conversation-work.md) extends change-driven scheduling to replica capture/readiness, conversation queues, and the bounded scheduler. Completion requires:

- Burst coalescing.
- Persistent peer hints.
- Deadline-preserving queue wakeups.
- Cancellation/fallback tests.
- Distributed audits within the existing integrity bound.
- Duplicate-health-write suppression.
- Installed-artifact acceptance.

The [change-driven work specification](../../../specifications/coordination/node-change-driven-work.md) owns the inventory and exact limits.

Local source and installed-artifact acceptance passed on 2026-09-11; see the [observation](../../../evidence/foundation/node-change-driven-work-v1.md). The subsequent authorized [WSL and coordinator rollout](../../../evidence/foundation/node-change-driven-work-deployment.md) verified seven Node processes and seven persistent peer streams. Six repository pairs converged; pre-existing Lervo source divergence remains unresolved. Equal live CPU windows do not establish additional CPU savings over ADR-0397.
