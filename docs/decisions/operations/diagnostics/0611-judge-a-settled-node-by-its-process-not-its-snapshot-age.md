# ADR-0611: Judge a settled Node by its process, not its snapshot age

Status: `accepted`
Decision date: 2026-11-22
Amends: [ADR-0602](../../knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md) (step 3, liveness on demand), [ADR-0480](../services/0480-defer-node-cache-warmups-past-readiness.md)

## Context

On 2026-11-22, after v0.31.1 reached every host, `lervo upgrade` blocked the Node stage of Mac argo with `node_runtime_inspect_runtime_failure`. Every Node on WSL showed the same cause: `ready` snapshots between 2 and 2.5 hours old, all written by processes that were still running. WSL shiflo and lervo were blocked the same way.

ADR-0602 ended idle cycles. An idle Node holds its Hub wait and runs no sync cycle, and the Node writes its health snapshot only on a cycle or a component change. A settled Node therefore writes nothing for hours. Three readers still treated a snapshot older than two minutes as stale:

- the fleet status that the upgrade Node stage and `lervo repository node status` read;
- the event reader inventory behind event writer activation;
- the readiness baseline, which already exempted settled snapshots.

ADR-0602's step 3 replaced heartbeats with liveness on demand, but these readers kept the heartbeat rule.

## Decision

`nodeHealthSnapshotCurrent` in `apps/cli/src/node-health-liveness.ts` is the only rule:

- A `ready` or `degraded` snapshot is current while the process that wrote it runs. Its pid must be alive, and `ps` must show that the process started no later than the snapshot's `startedAt`, so a reused pid never counts.
- A `starting` or `stopping` snapshot is current for two minutes after `updatedAt`. A live process keeps refreshing it, as ADR-0480 decided.

All three readers use it. The event reader inventory also still refuses a snapshot written more than five seconds ahead of its clock.

The Node arms no timer for this. A settled-state heartbeat would undo ADR-0602's guard, which lists the starting heartbeat as the Node health module's only interval.

## Consequences

- An idle Node stays `ready` in fleet status and in the upgrade Node stage for as long as its process runs.
- A Node whose process exited is `stale` as soon as it is read, without waiting two minutes.
- A Node whose event loop is stuck still counts as running. That is the same limit ADR-0602 accepted for presence probes.
- The readers start one `ps` call for each settled instance they read. No event, schema or wire format changes.

## Verification

- `apps/cli/test/node-fleet-health.test.ts` registers a Node and writes a `ready` snapshot that is 2.5 hours old.
  - With its process running, fleet status reports `ready` with recovery `none`.
  - With its process gone, it reports `stale`.
  - A `starting` snapshot of the same age is `stale`.
  - Without this change, the first case fails with `stale`.
- `apps/cli/test/event-reader-inventory.test.ts` accepts an old settled snapshot from a running process and refuses one whose process is gone, and also an old `starting` snapshot.
