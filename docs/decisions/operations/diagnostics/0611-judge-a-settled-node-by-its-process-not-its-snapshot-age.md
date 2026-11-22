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

`nodeHealthSnapshotCurrent` in `apps/cli/src/node-health-liveness.ts` is the only rule. All three readers use it.

- **Settled snapshots.** A `ready` or `degraded` snapshot is current while the process that wrote it runs. The Node proves that the way ADR-0602 step 3 decided, by presence and not by a heartbeat:
  - At startup the health publisher holds a process presence. It records the presence token as `presenceToken` once the socket listens. The kernel closes the socket when the process exits.
  - A reader probes the token. A presence that answers is `alive`; one the kernel proves `gone` is not current.
- **Fallback.** A snapshot without a token, written by an earlier release or by a Node that could not hold its presence, falls back to the process id. A presence this host cannot judge falls back the same way. The pid must be alive, and `ps` must show that the process started no later than the snapshot's `startedAt`. That keeps a reused pid from counting, but a forward wall-clock step can make a live process fail the check.
- **Starting and stopping snapshots.** A `starting` or `stopping` snapshot is current for two minutes after `updatedAt`. A live process keeps refreshing it, as ADR-0480 decided.
- **Clock lead.** The event reader inventory also still refuses a snapshot written more than five seconds ahead of its clock.

The Node arms no timer for this. A settled-state heartbeat would undo ADR-0602's guard, which lists the starting heartbeat as the Node health module's only interval.

### Why the presence and not the start time

The first form of this rule judged settled snapshots by pid and start time alone. Review found that on Linux `ps` measures elapsed time from boot. After WSL resumed from host sleep, or after an NTP step, the wall clock jumps ahead of that measure. The computed start then lands after `startedAt`, and a live Node reads as gone until it restarts. That is the same block this ADR removes. The presence socket depends on no clock.

## Consequences

- An idle Node stays `ready` in fleet status and in the upgrade Node stage for as long as its process runs.
- A Node whose process exited is `stale` as soon as it is read, without waiting two minutes.
- A Node whose event loop is stuck still counts as running. That is the same limit ADR-0602 accepted for presence probes.
- The readers make one local socket probe for each settled instance they read. They start a `ps` call only for a snapshot without a usable token.
- The snapshot gains the optional `presenceToken` field. Its validator never rejected unknown fields, so earlier readers accept new snapshots. No event or wire format changes.

## Verification

- `apps/cli/test/node-fleet-health.test.ts` registers a Node and writes a `ready` snapshot that is 2.5 hours old.
  - Without a token, a running process gives `ready` with recovery `none`, and a gone process gives `stale`. Without this change, the first case fails with `stale`.
  - With the token of a live presence, the snapshot stays `ready` even when the start-time check fails, which is the clock-step case. Once the presence is released, it is `stale`.
  - A `starting` snapshot of the same age is `stale`.
- `apps/node-runtime/test/health.test.ts`: the publisher records a token that probes `alive`, and `gone` after `close`. With no presence held it records no token and still starts.
- `apps/cli/test/event-reader-inventory.test.ts` accepts an old settled snapshot from a running process. It refuses one whose process is gone, and an old `starting` snapshot.
