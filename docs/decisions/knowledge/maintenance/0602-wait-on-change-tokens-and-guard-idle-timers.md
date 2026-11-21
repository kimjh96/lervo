# ADR-0602: Wait on change tokens and guard idle timers

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (the event head poll behind a directory watch), [ADR-0597](0597-keep-idle-and-non-owner-residents-off-the-repository.md) (the watched poll interval), [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md) (the wake path every watcher shares)
Related: [ADR-0599](0599-read-health-history-incrementally-and-fence-non-owners-without-git.md), [ADR-0601](0601-read-queues-health-inputs-and-retention-roots-once-per-change.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

On v0.29.9 the knowledge residents were idle at about 0.3 percent of a core each. The per-repository Node services were not: six idle services on WSL used about 13 percent of a core together, and one Mac service spent most of its main thread re-reading history.

Ten-minute CPU profiles on 2026-11-20 showed where:

| Host, process             | Busy main thread | Cause                                                                                                                                |
| ------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Mac, argo Node service    | 411 s in 600 s   | `WorkstreamRevisionReader` full audit every 45–60 s: whole log decoded and re-hashed (250 s), every snapshot re-read from CAS (35 s) |
| WSL, busiest Node service | 40 s in 600 s    | The same audit (16 s), `SupervisionAuthorityHistory` re-streaming the log every 15 min (11 s), row clones (5 s)                      |
| Mac, same service         | 8 s in 600 s     | The one-second event head poll behind a directory watch                                                                              |

The Mac knowledge host measured 0.51 percent. A backoff poll (1 to 15 s) was rejected: an idle host does no periodic work, and every failure is prevented, recovered or visible.

## Decision

An idle host wakes only for a change or a known deadline. The work lands in three steps on one branch and ships in one release: (1) a writer-side change channel, history verified on open and at use, and a structural guard; (2) one timer for the earliest known deadline in place of interval loops; (3) liveness checked on demand in place of heartbeats.

### Writers deliver a ping before the commit returns

Every event and outbox write goes through `SQLiteEventStore.transact`, in the CLI, hooks, Node services and the knowledge host alike. After its `COMMIT`, `transact` calls `notifyEventStoreChange(path)`.

- **Rendezvous:** for `<repository>/.lervo/data/<name>` the FIFOs live in `<repository>/.lervo/run/<name>/`. That is outside derived state, so `lervo state` status, reset and prune never read or move them. A `.gitignore` of `*` keeps Git away, and snapshots, replicas, workspace seals, document and source scans exclude `.lervo/run`. A database elsewhere keeps `<name>.run/` beside itself. Both directory levels must be real directories, owned by the database owner and by the process's effective user, and writable by nobody else. They are checked with `lstat`, and anything else is refused.
- **Subscriber:** creates one FIFO `<host>-<boot>-<pid>-<nonce>.fifo` (mode 600) with `mkfifo` (`/usr/bin`, `/bin`, then `PATH`) under a temporary name, opens it for reading and writing, renames it into place, and holds it while it lives. `<host>` hashes the machine id (Linux machine-id, macOS IOPlatformUUID, Windows MachineGuid) with the host name, so cloned ids and shared home directories still give two machines two keys. The key decides only removal and reporting, never pinging, so a host-name change only keeps and reports this host's leftovers. The key is cached per host name in a private 0600 file of the user. `<boot>` is the Linux boot id, or the boot time from the uptime.
- **Writer:** for each FIFO of its own kernel owned by the directory owner, it opens the FIFO with `O_WRONLY | O_NONBLOCK | O_NOFOLLOW`, checks with `fstat` that it is a FIFO, writes one byte and closes it. This is synchronous and takes about 0.1 ms, so the byte is in the kernel's pipe buffer before `transact` returns, even if the process exits at once. It never blocks and never fails the write.
- **Proof of exit:** only ENXIO from a FIFO of this host or kernel (Windows: a lock that opens exclusively) proves a subscriber gone, whatever its boot key says, since a clock step can make a live boot look like another. Writers, inspection and every starting subscriber then remove it, through a tombstone and an inode check, with its records. A boot key alone removes only records, which a live subscriber rewrites. Every FIFO is pinged whatever its identity: one only opens when a reader on this kernel holds it, so an unknown key loses no wake. A FIFO of another host or with an unknown key is never removed; it is reported.
- **Windows:** a subscriber creates `<id>.ping` in its private run directory, holds `<id>.lock` open with an exclusive share mode, and watches the directory (ReadDirectoryChangesW). A writer appends one byte to each ping file whose lock is held, synchronously. A lock that opens exclusively proves its subscriber gone, so the writer removes its files. Ping files are truncated past 4 KiB, and an append that fails twice writes a new uniquely named file beside it. A file write cannot impersonate the writer, unlike a pipe client.

### One change-token watch

`watchChangeToken` in `@lervo/project-storage` is the one wait every resident and Node event watcher uses. `watchProjectEventChanges` (and its Node alias `watchLocalEventChanges`) builds it on the FIFO channel. That covers the knowledge residents, deployment, supervision store, peer catalog and conversation signals.

- It arms its sources first, then reads a cheap token: the head hash (ADR-0597) or the resident wake key (ADR-0598, ADR-0601).
- It reads the token again only on a signal, once per burst (a 50 ms one-shot debounce). Its caller reads from its own cursor on every wake, so a coalesced ping strands nothing.
- Every check also verifies the subscriber's own channel: a failed reader, a removed FIFO or a missing run directory is rebuilt, and the check then catches up. There is no poll.

The kernel watch on the database directory stays only as a detector. A commit it sees without a ping still wakes the watch. If no ping follows within one turn of the event loop, counting one still unread in the FIFO, it raises `event_channel_writer_without_ping` (an older binary, or another user's process). A check that rebuilt the channel does not judge. The state clears once a change arrives with a ping.

### History is verified on open, per read, and at use

`WorkstreamRevisionReader` and `SupervisionAuthorityHistory` no longer re-read their history on a timer:

- A new reader verifies the whole chain from the first event, and the workstream reader also verifies every snapshot artifact.
- Later reads check the database identity, the anchor and the tail, and chain-verify every appended event. A moved anchor resets the reader.
- Readers hand out only copies they verified. Above 65,536 cached revisions or 32 MiB of artifacts, only the artifact cache is dropped, never the cursor. argo measured 1,036 revisions and 18.2 MB of artifacts.
- The event channel wakes supervision for each appended event, so its 60-second tail check and `nextAuditAt` are gone.

Every event the store returns is proven at use: `get` and `list` check each row's hash and its links to its stored neighbours, so a changed row is rejected wherever it is read. Doctor and integrity verification read raw rows, so corruption stays inspectable. Before history leaves the host, the exact range is proven once more:

- `verifyForPublish` checks the workstream anchor, each published revision's recording event and its artifact.
- `verifyDeliveryRange` checks every event of a Hub batch. A failure reschedules the batch and reports `local_history_invalid` in the Node sync health.

Trust boundary: a principal with write access to the repository's own state is the owner. Detection of a history rewritten consistently through the head relies on the Hub cursor when one is configured: the next batch no longer extends the Hub's chain, and sync fails closed.

### Problems are attention

Each record has one owner and a unique name, in `.lervo/state/event-channel/<name>/`:

- **A subscriber's own record:** its presence and issues, kept for as long as it runs and rewritten if a state reset moved it.
- **A writer's record about one subscriber:** stalled (EAGAIN) or unreachable (EACCES or another error), cleared by that writer's next landed ping, and the stall also by the subscriber's next read.
- **The head each subscriber last observed:** written when it changes, at most once a second. Each commit's sequence range and time go into a 64-entry ring beside the records, written inside the transaction before COMMIT so the write lock serializes writers; an event with no entry is timed by the next later commit, never sooner; a ring needs no event schema migration and times exactly the commits a subscriber has not seen, unlike an event's own `occurredAt`. Inspection, given the store and outside Node start or stop, reports `event_channel_subscriber_stalled` when an unobserved event was committed over 30 seconds ago. A consumer that hangs above the channel is part 3's liveness check.

`inspectEventStoreChannel` counts a record only while its subscriber lives and removes records proven gone. It also reports a refused run directory, a run directory missing while subscribers run, and FIFOs of another host or an unknown identity. Each repository watch has its own record in `.lervo/state/repository-watch/`. The CLI adds both to operating attention, and each issue carries a fix.

### Step 2: one deadline instead of intervals

Each loop arms one timer for its earliest known deadline, recomputed whenever a deadline changes, and none when it knows none:

- **Resident loop:** the deadlines are a delivery or local stage falling due (practice, the skill day boundary, `availableAt`), a publication retry, the owner's lease renewal, continuity's next time-based moment, the health projection's age bound, and a retry after a failure or an ownership the Hub could not confirm. There is no idle backoff and no forced cycle: an unchanged fingerprint skips however old it is. A wall-clock step or a sleep only ever makes a deadline late, never early.
- **Hub state is pushed.** The Hub long-poll gains a `knowledge` topic: a new lease holder or release, an owner-rule candidate, a host record whose facts changed or a new definition wakes the repository's other hosts, never the writer; an answer names what changed, and a host record or presence change turns only continuity. The resident holds it, and folds its token into the fingerprint. Liveness bound (decided): every held wait is answered within ten minutes and reconnects at once, and the client ends one unanswered past it. A release is taken over at once; a holder that vanishes is taken over at its lease expiry. Node's workstream and command waits hold open too. Hub presence (who holds a wait) replaces record age as peer liveness.
- **Continuity** reconciles when its host-local inputs change, on a Hub change or a takeover, or at its next time-based moment.
- **Wakes:** every host's resident watches events and the repository by default. The repository watch has no recovery poll; its notifications are level-triggered. The projection inputs, the host hold store and the writer coordinate are watched files.
- **Change loop** (supervision, result branch, Node knowledge loop): a change or the next deadline, never an interval. A deadline already past when a cycle ends gets one more cycle, then waits for a change or a new deadline.
- **CLI host residents:** a rescan follows a change of the repository or Node registry, the continuity policy, a delegation or the terminal runtime pointer, or a held checkout's retry time.
- **Replica watch:** with the local watch and every peer subscription live, no recovery cycle runs. A quiet peer stream writes nothing; SSH keepalives end a dead link and the subscriber reacts only to EOF or an error. A stopped peer that keeps the link open harms nothing while no work is pending, and the next transfer's deadline reports it. A lost source is re-armed with backoff and shown in health.
- **Supervision peers:** a live peer is observed again only when its event store changes; one that could not be opened is retried after a minute. An inactive workstream is settled until an event or its workstream files change, and workforce sources are watched.
- **Failures** that recur back off exponentially to a ceiling and stay visible until they clear.

### Step 3: liveness on demand

A process proves it runs by holding a local presence socket, never by a heartbeat; a reader probes it, and a waiter holds a connection the kernel closes at the holder's exit. Resident and CLI host health are written only on change; admission waiters, a standby host and upgrade preemption wake on a release, an exit or a ping; the owner lease stays live while its holder holds its Hub wait; when the holder leaves, its expiry never drops below the one the holder was last given. Earlier releases' records keep their heartbeat rules; an earlier Hub raises `hub_upgrade_required` and gets an hourly full cycle and timed renewal.

## Failure modes

[Idle wakeups and the event-store wake channel](../../../specifications/execution/idle-wake-channel.md) lists every failure of the wake path with the mechanism that prevents, recovers or surfaces it and the test that proves it.

### A structural guard

`scripts/quality/check-idle-timers.mjs` runs in `pnpm architecture:check`. Its scope is the Node runtime, the knowledge runtime, project storage, the event store, the CLI host residents, the Hub, sync, and the conversation platform and Discord adapters. With comments and strings removed, it finds:

- `interval`: a `setInterval` call;
- `rearm`: a `setTimeout`, `setImmediate`, `process.nextTick` or `queueMicrotask` whose callback reaches a function that encloses it, directly or through calls within the module;
- `loop`: such a call, an awaited `sleep` or `delay`, or an awaited module function that arms one, inside a loop;
- `period`: a constant or option whose name contains poll or interval and ends in milliseconds, set to a number.

Each finding must be listed in `scripts/quality/idle-timer-allowlist.json` with a reason and an exact count, and a stale entry fails. Entries that steps 2 and 3 remove say so. The rest run only while bounded work runs, are armed only after a failure, or are rate limits that arm no timer.

## Inventory of periodic work (2026-11-20, v0.29.9)

- Event watchers polled every 1 s and the knowledge resident every 30 s; they now use the FIFO channel. The workstream audit (45 to 60 s) and the supervision audit (15 min, tail 60 s) now verify on open, on an anchor change and at use.
- Step 2: the change loops' and resident's backoff, the projection, continuity and hold checks, the repository watch poll, replica recovery and peer reconcile, peer re-observation, the writer coordinate poll and the CLI host rescan became watches and single deadlines.
- Step 3: the resident, admission-hold and CLI host heartbeats, the owner lease renewal, the admission waiter heartbeat and poll, upgrade preemption and the standby host lock retry became presence and signals.
- Allowlisted: timers that end with their work (provider calls, leases, managed processes, reasoning effects, Discord typing) or are armed only by a change or a failure.

## Consequences

An idle watcher reads its token once, an idle history reader decodes nothing, and every condition that could keep a service from waking is attention with a fix.

## Verification

Each failure in the linked specification names its test. `.github/workflows/event-channel-windows.yml` runs the channel tests on Windows.

## Follow-ups

- Measure the installed release with a 10-minute profile of one WSL and one Mac Node service. Target: under 0.5 percent of a core per idle service.
