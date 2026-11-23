# ADR-0628: Bound replica transport and preserve the installed coordinator

- Status: accepted (amended 2026-09-16)
- Decision date: 2026-09-16
- Amended by: [ADR-0570](../../operations/services/0570-reuse-one-replica-peer-connection-and-back-off-an-unreachable-peer.md) (one reused peer connection and a shared back-off for an unreachable peer), [ADR-0573](../../distribution/0573-restart-a-replica-coordinator-that-runs-a-superseded-runtime.md) (service inspection on macOS and Linux, and `repository_replica_service_stale_runtime`)

## Context

The installed Mac repository-replica coordinator was unloaded during repository verification and not restored. Required-replica Discord work then waited for fresh parity and correctly refused to run. Ordinary Node fleet status remained ready because the coordinator is an external service.

Restarting the coordinator exposed another availability defect: four concurrent SSH commands entered the Windows-to-WSL command bridge and stopped producing output. They had an output bound but no execution deadline, occupying all reconciliation capacity indefinitely. Later repositories, including the repository serving Vero, could not refresh readiness receipts.

## Decision

Every repository-replica SSH request has a default 60-second execution deadline. Owner-only coordinator configuration may set `peer.commandTimeoutMs` from 1,000 through 300,000 milliseconds. Expiry kills the local transport process, releases the keyed reconciliation slot, and reports a bounded transport failure. It never treats the repository as current or writes a receipt.

Coordinator configuration may set `maximumConcurrency` from one through four; four remains the portable default. Constrained bridges such as Windows `wsl.exe` may use one to prevent simultaneous snapshot, bundle, and apply processes from saturating the bridge. Repository independence and existing coalesced successor-run behavior remain unchanged within that bound.

Such a bridge may also set `peerWatch` to `false`, retaining local filesystem watches but replacing one persistent SSH/WSL process per peer repository with finite snapshot recovery at `pollIntervalMs`. Exact reconciliation remains authoritative; this changes notification transport, not source authority or readiness semantics.

Timer recovery schedules a full sweep only while the keyed reconciliation pool is idle. A sweep lasting longer than the configured interval therefore does not enqueue perpetual successor sweeps. Real source-change hints during an active run still retain exactly one coalesced successor.

Every bundle is bound to the snapshot selected by reconciliation. Source advancement before bundle creation causes that attempt to retry instead of exporting different bytes. After an exact target apply succeeds, its snapshot becomes the persisted common base before both sides are recaptured. Concurrent source advancement therefore produces a pending one-sided successor cycle, not false dual divergence from the previous common base. Receipts still require fresh equality.

On macOS, direct terminal completion inspection treats an installed owner-only `dev.lervo.repository-replica` LaunchAgent as an operational dependency. An unsafe definition, failed inspection, or unloaded service makes the turn report action required. The check does not automatically install, start, or authorize the service. This closes the lifecycle gap that allowed an agent to unload the coordinator and still finish its repository turn.

The derived issue codes are `repository_replica_service_inactive`, `repository_replica_service_definition_unsafe`, and `repository_replica_service_inspection_failed`. They contain no repository paths, command output, source bytes, message text, credentials, or provider payloads. SSH deadline failures likewise retain no remote output beyond the existing bounded failure log.

## Consequences

A stopped installed coordinator becomes visible before a direct terminal turn can complete. A hung peer command or excessive persistent-watch fan-out cannot occupy reconciliation capacity forever. Exact snapshot verification, conflict policy, and receipt freshness remain unchanged.

Fail-closed native-work admission applies only when the deployment explicitly enables required parity. The installed conversation default uses its always-on WSL repository as the execution source and keeps the coordinator asynchronous.

An operating-system bridge can still fail and require host recovery. The deadline proves only that Lervo releases its own worker, not that a remote operating system terminated every descendant process. Constrained deployments therefore combine the deadline with reduced concurrency and continue to rely on the existing recovery sweep.

## References

- [Conflict-safe repository replica continuation](0396-conflict-safe-repository-replica-continuation.md)
- [Change-driven repository and conversation work](0399-change-driven-repository-and-conversation-work.md)
- [Remove change-driven batch barriers](0414-remove-change-driven-batch-barriers.md)
- [Repository replicas](../../../specifications/coordination/node-change-driven-work/repository-replicas.md)
