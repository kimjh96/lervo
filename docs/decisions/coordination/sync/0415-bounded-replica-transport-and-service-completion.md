# ADR-0415: Bound replica transport and preserve the installed coordinator

- Status: accepted
- Decision date: 2026-09-16

## Context

The installed Mac repository-replica coordinator was unloaded during repository verification and
was not restored. Required-replica Discord work then waited for fresh parity and correctly refused
to run, while ordinary Node fleet status remained ready because the coordinator is an external
service.

Restarting the coordinator exposed a second availability defect. Four concurrent SSH commands
entered the Windows-to-WSL command bridge and stopped producing output. The commands had an output
bound but no execution deadline, so all reconciliation capacity remained occupied indefinitely.
Later repositories, including the repository serving Vero, could not refresh their readiness
receipts.

## Decision

Every repository-replica SSH request has a 60-second execution deadline by default. Owner-only
coordinator configuration may set `peer.commandTimeoutMs` from 1,000 through 300,000 milliseconds.
Expiry kills the local transport process, releases the keyed reconciliation slot, and reports a
bounded transport failure. It never treats the repository as current and never writes a receipt.

Coordinator configuration may also set `maximumConcurrency` from one through four. Four remains the
portable default. Constrained bridges such as Windows `wsl.exe` may use one so simultaneous snapshot,
bundle, and apply processes cannot saturate the bridge. Repository independence and the existing
coalesced successor-run behavior remain unchanged within that configured bound.

On macOS, direct terminal completion inspection treats an installed owner-only
`dev.lervo.repository-replica` LaunchAgent as an operational dependency. If its definition is unsafe,
cannot be inspected, or is not loaded, the turn reports action required. The check does not install,
start, or authorize the service automatically. It closes the lifecycle gap that previously allowed
an agent to unload the coordinator and still finish its repository turn.

The derived issue codes are `repository_replica_service_inactive`,
`repository_replica_service_definition_unsafe`, and
`repository_replica_service_inspection_failed`. They contain no repository paths, command output,
source bytes, message text, credentials, or provider payloads. SSH deadline failures likewise retain
no remote output beyond the existing bounded failure log.

## Consequences

A stopped installed coordinator becomes visible before a direct terminal turn can complete, and a
hung peer command cannot occupy reconciliation capacity forever. Exact snapshot verification,
conflict policy, receipt freshness, and fail-closed native-work admission are unchanged.

An operating-system bridge can still fail and may require host recovery. The deadline proves only
that Lervo releases its own worker; it does not claim that a remote operating system terminated every
descendant process. Constrained deployments therefore combine the deadline with reduced concurrency
and continue to rely on the existing recovery sweep.

## References

- [Conflict-safe repository replica continuation](0396-conflict-safe-repository-replica-continuation.md)
- [Change-driven repository and conversation work](0399-change-driven-repository-and-conversation-work.md)
- [Remove change-driven batch barriers](0414-remove-change-driven-batch-barriers.md)
- [Repository replicas](../../../specifications/coordination/node-change-driven-work/repository-replicas.md)
