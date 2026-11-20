# Idle wakeups and the event-store wake channel

Status: `active`
As of: 2026-11-20

Defines how each failure of the wake path is prevented, recovered or made visible, and the test that proves it. [ADR-0602](../../decisions/knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md) retains the decision and its rationale.

## Failure modes

Each failure is prevented, recovered or visible; the test that proves it follows the arrow.

- **A writer exits right after committing.** Prevented: the ping is written synchronously before `transact` returns. → `change-channel.test.ts` (a child pings and calls `process.exit(0)`; a child commits through a real `SQLiteEventStore`).
- **A rolled-back transaction.** Prevented: only a commit pings. → `event-store-change-ping.test.ts` counts the FIFO bytes.
- **A stopped, slow or full subscriber.** Prevented and visible: writes are non-blocking, EAGAIN means pings wait, others are unaffected, and the stall shows within 30 seconds from the commit-time ring, which racing writers fill under the write lock. → `change-channel.test.ts` (a `SIGSTOP`ped subscriber; an unobserved commit; two racing writer processes).
- **A crashed subscriber's FIFO.** Recovered: with no reader on this kernel the open fails with ENXIO, and the writer removes the FIFO, its records and its temporary files through a tombstone. → `change-channel.test.ts` (a `SIGKILL`ed child).
- **Another host, a previous boot, a clock step, a host-name change or an unknown identity.** Recovered or visible: removal needs ENXIO or a free lock from this host's key; a live FIFO with a stepped boot key stays; another key is reported, kept and still pinged. → `change-channel.test.ts`, `process-identity.test.ts`.
- **A commit that races the subscription.** Prevented: the sources are armed before the first token read. → `change-token-watch.test.ts`.
- **Coalesced pings.** Prevented: a ping carries no data, each wake reads the token, and the caller reads from its own cursor. → `change-token-watch.test.ts`.
- **A failed or removed FIFO, or a removed run directory.** Recovered and visible: every check rebuilds the channel and catches up. While it is missing, the subscriber's record raises `event_channel_unavailable`. → `change-channel.test.ts`, `change-token-watch.test.ts`.
- **A writer that does not ping (an older binary).** Recovered and visible: the directory watch wakes the watch and raises `event_channel_writer_without_ping`. → `change-token-watch.test.ts`.
- **No directory watch, or no source at all.** Visible: `event_channel_detector_unavailable` and the watch's health. → `change-token-watch.test.ts`.
- **A symlinked, foreign-owned or group-writable run directory.** Prevented and visible: writers never write there, and `event_channel_refused` is raised. → `change-channel.test.ts`, `wake-channel-attention.test.ts`.
- **A filesystem without FIFOs, or no `mkfifo`.** Visible: `event_channel_unsupported` or `event_channel_mkfifo_missing` in that subscriber's record. → `change-channel.test.ts`.
- **`lervo state` status, reset and prune.** Prevented: the FIFOs are outside derived state, and channel and watch records are lifecycle-owned. → `state-plans-event-channel.test.ts` (with a live subscriber).
- **A writer that cannot open a FIFO (another uid or mode).** Visible: `event_channel_subscriber_unreachable`, cleared when that writer's pings all land. → `change-channel.test.ts`.
- **A repository watch that cannot be armed (ENOSPC, EMFILE).** Visible: `repository_watch_unavailable` with the fix, in that watch's own record, cleared when it is armed. → `repository-watch-state.test.ts`, `wake-channel-attention.test.ts`.
- **History rewritten after a reader verified it.** Prevented at use: the store rejects a row whose hash or neighbour links changed wherever it is read, readers act only on verified copies, and publication and Hub batches re-prove their exact range. → `event-store.test.ts`, `workstream-revision-reader.test.ts`, `delivery-verification.test.ts`, `worker.test.ts`, `workstream-replication.test.ts`.
- **Windows.** Prevented: the same guarantees over ping files and exclusive locks, with no pipe to impersonate a writer. A watch that cannot be armed raises `event_channel_unavailable`. → `change-channel.test.ts` in the Windows job.
- **An idle host.** Prevented: there is no token read, store call, database open or timer. → `resident-idle-wait.test.ts` (12 simulated hours).

## References

- [ADR-0602](../../decisions/knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md)
- [Events and privacy](events-and-privacy.md)
- [State lifecycle](state-lifecycle.md)
