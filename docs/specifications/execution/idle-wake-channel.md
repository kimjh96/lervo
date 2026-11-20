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

## Deadlines and push (step 2)

Nothing runs on a cadence. A timer is armed only for a known moment (a due time, a lease expiry, a failure retry), and Hub state arrives as a push. A wall-clock step or a sleep only ever makes a deadline late, never early: timers run on the monotonic clock and fire only names whose wall-clock moment has passed.

- **A resident with nothing due.** Prevented: no timer at all, and no age bound on an unchanged fingerprint. → `loop.test.ts` (no `setTimeout` or `setInterval` while asleep), `loop-health.test.ts`, `resident-cycle.test.ts`, `resident-deadline-timer.test.ts`.
- **Hub state with no local signal** (owner-rule candidates, host records, definitions, the lease holder). Recovered at once: each Hub write notifies the `knowledge` topic of the repository's other hosts, never the writer's own; the resident holds that wait open and folds its token into the fingerprint, so the next cycle runs in full. → `knowledge-change-wait-http.test.ts`, `knowledge-convergence-hosts-http.test.ts`, `hub-knowledge-changes.test.ts`.
- **A held wait with no traffic.** Prevented: an `open` hold arms no timer on either side; TCP keepalive (15 seconds, in the kernel) ends a dead connection, and the wait reconnects with its cursor, so the same Hub holds again with no change. → `runtime-change-notifications.test.ts`, `runtime-idle-wait.test.ts`.
- **A Hub wait that fails.** Recovered and visible: it retries with exponential backoff and raises `hub_knowledge_changes_unavailable` or `hub_runtime_changes_unavailable` until it is answered again. → `hub-knowledge-changes.test.ts`, `runtime-idle-wait.test.ts`.
- **A lease released by its holder.** Recovered at once: the release notifies the waiting host, which takes over without waiting for the expiry; on the same checkout a release command rewrites the watched owner fence. A holder that vanishes without releasing is taken over at its lease expiry, the one deadline. → `non-owner-takeover.test.ts` (no clock skew, with the whole lease and with twenty seconds left).
- **Peer liveness.** Prevented from needing a heartbeat: the Hub reports whether each host holds its `knowledge` wait, and a peer is unreported only after ten minutes without one; a disconnection is pushed after a five-second grace. → `runtime-change-notifications.test.ts`, `continuity-findings.test.ts`.
- **Continuity.** Recovered on change: it reconciles when its host-local inputs differ from the ones it recorded, when a Hub change forces it, or at its own next time-based moment; its policy, owner-host and provider-pause files are watched. Its state is stale only once that moment passed unobserved. → `continuity-findings.test.ts`, `convergence-continuity.test.ts`.
- **A projection deadline during a cycle.** Prevented from spinning: an age-only offer's deadline is the age bound, a due retry refreshes, and the timer refuses a deadline set back to the past moment it just fired at. → `loop-health.test.ts` (a moved head during a running cycle), `resident-projection-fence.test.ts`, `resident-deadline-timer.test.ts`.
- **A hold released during a cycle.** Recovered: the cycle runs once more. → `loop-health.test.ts`.
- **A watched directory created later, or a change during a CLI host scan.** Recovered: the nearest existing ancestor is watched and re-armed toward it, and the CLI host keeps its watch across scans. → `hub-knowledge-changes.test.ts`, `knowledge-host-residents.test.ts`.
- **An edit to `.git/info/exclude`.** Recovered at once: `.git/info` is watched. → `repository-change-watch.test.ts`.
- **A failure that keeps recurring** (a change loop cycle, an unreadable writer coordinate, a repository watch that cannot be armed, a lost replica source). Recovered and visible: exponential backoff to a ceiling, reported until it clears. → `conversation-change-loop.test.ts`, `knowledge-worker-admission.test.ts`, `knowledge-worker-wakeups.test.ts`, `repository-replica-watch.test.ts`.
- **A dormant supervision owner.** Prevented from polling: an inactive workstream is settled, woken by an event or by the current-workstream and branch-binding files; workforce sources are watched too. → `supervision-change-loop.test.ts`, `supervision-wake-sources.test.ts`.
- **An idle replica peer stream.** Prevented: a quiet stream writes nothing and arms no timer. SSH keepalives end a dead link, and that EOF is the only failure; a stopped peer process that keeps the link open does no harm while nothing is pending, and the next transfer's command deadline reports it once work arrives. → `repository-replica-ssh-subscription.test.ts`, `repository-replica-watch.test.ts`.
- **A held Node resident waiting for activation.** Recovered when the writer coordinate changes. → `knowledge-worker-admission.test.ts`.

## References

- [ADR-0602](../../decisions/knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md)
- [Events and privacy](events-and-privacy.md)
- [State lifecycle](state-lifecycle.md)
