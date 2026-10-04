# Repository replicas

The coordinator reconciles repository snapshots through subscriptions, recovery, exact capture, optional readiness enforcement, divergence resolution, and structured failure reporting.

- [Subscriptions and recovery](repository-replicas/subscriptions-and-recovery.md)
- [Snapshot capture](repository-replicas/snapshot-capture.md)
- [Readiness](repository-replicas/readiness.md)
- [Divergence and merge](repository-replicas/divergence-and-merge.md): when both sides changed since the common snapshot, merges the peer's exact replica locally before deciding again, as defined by [ADR-0404](../../../decisions/coordination/sync/0404-merge-divergent-repository-replicas.md); surfaces each held divergence once per identity under [ADR-0456](../../../decisions/coordination/sync/0456-hand-off-repositories-atomically-with-a-writer-lease.md).
- [Failure fidelity](repository-replicas/failure-fidelity.md): structured code, stage, Git exit code, and redacted stderr digest in logs, receipts, and coordinator health.
