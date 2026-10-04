# Background convergence recovery and retention

Status: `active`
As of: 2026-09-28

The recovery and retention contract covers:

- [Assignment failure and retry](recovery-and-retention/assignment-failure-and-retry.md)
- [Known effects and uncertainty](recovery-and-retention/known-effects-and-uncertainty.md)
- [Workspace closure and retention](recovery-and-retention/workspace-closure-and-retention.md)
- [Archive event and privacy](recovery-and-retention/archive-event-and-privacy.md)

## Watch notification recovery

When native filesystem notifications are silent, local source subscriptions compare a disposable metadata fingerprint every sixty seconds. A changed fingerprint emits only a hint; authoritative source capture and admission still precede effects. The [replica subscription contract](../../specifications/coordination/node-change-driven-work/repository-replicas.md) defines bounded inputs and shutdown behavior.

The [unattended scheduler](../../specifications/coordination/node-change-driven-work/conversation-scheduling.md) probes the exact kill-switch path once per second only during an active wait. An existing entry or unexpected inspection failure wakes the authoritative scheduler check; absence does not. Completion and shutdown clear the deadline and probe timer. This safety probe neither scans repositories nor creates ordinary work.

## Verification

Focused regressions cover:

- Exact failed-assignment reopening after a native probe.
- Repeated provision/seal.
- Verified integration before root apply under a new lease.
- Integrator/source cleanup.
- Archive append failure and dependent protection.
- Successive target generations.
- New source roots.
- Reviewed normalization lineage.
- Preservation of manual divergence.

An actual subprocess killed after canonical file apply but before materialization evidence append restarts as owned journal uncertainty, records no currency, and invokes no provider again. The [implementation evidence](../../evidence/quality/background-knowledge-convergence-implementation.md) records installed observations and remaining unobserved windows.
