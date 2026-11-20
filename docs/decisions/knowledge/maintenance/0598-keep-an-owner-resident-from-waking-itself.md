# ADR-0598: Keep an owner resident from waking itself

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0597](0597-keep-idle-and-non-owner-residents-off-the-repository.md) (which events enter the fence), [ADR-0580](0580-let-a-resident-with-parked-work-back-off.md) (which freshness cycles record an event and when a debt retry reopens the stage), [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (which events wake a resident), [ADR-0576](../../operations/storage/0576-keep-full-cycle-admission-waits-through-sqlite-lock-contention.md) and [ADR-0577](../../distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md) (how an admission waiter polls)
Related: [ADR-0466](../../coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md), [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

After v0.29.5 installed on 2026-11-20, the WSL host still used about 111 percent of a CPU core. WSL owns its repositories, and ADR-0597 had only quieted non-owners. In a 120-second sample the owner workers used:

| Repository | CPU | State                                         |
| ---------- | --- | --------------------------------------------- |
| lervo      | 41% | `attention_required`                          |
| shiflo     | 22% | `attention_required`                          |
| plen       | 18% | idle, nothing outstanding                     |
| flemo      | 11% | normalization retrying `source_bytes_changed` |

A 10-minute profile of the plen worker found 78 seconds of CPU. The worker was not idle: it woke itself every two to three minutes.

1. **The freshness stage reopened every cycle.** plen held a freshness debt whose retry time had passed, so the stage's fence failed. Today's budget was already spent, so the retry only reported `skippedForBudget`. ADR-0580 checked affordability for a pending review, not for a debt retry.
2. **It appended an event although nothing happened.** ADR-0580 withholds the cycle event only for a deferral. This cycle deferred nothing, admitted nothing and spent nothing, so it appended `document.freshness.cycle.completed` with the same payload as last time: 50 times in 85 minutes.
3. **The resident's own event woke it and moved its fence.** The event watch fires on any append, and the fence includes the event head. Each self-appended event therefore forced another full owner cycle: scans, Git dependency checks, lint and normalization inspection. flemo looped the same way through `repository.knowledge.stage.recorded`, which records each `source_bytes_changed` retry.
4. **Waiting residents polled the host admission every second.** While one resident held the full-cycle admission, each waiter reopened the admission database once a second. Every poll ran the WAL pragmas and two `CREATE TABLE IF NOT EXISTS` statements and committed a heartbeat. That cost 3 of the profile's 34 main-thread seconds.

## Decision

### A resident ignores its own outcome records

`RESIDENT_AUTHORED_EVENT_TYPES` in `resident-authored-events.ts` names the events a resident appends only to record its own outcome. Each is committed together with the state that carries its follow-up, and the fence already reads that state:

- **`repository.knowledge.stage.recorded`:** the successor job is enqueued in the same commit. The fence reads the knowledge outbox counts and the earliest due time, and a due delivery is never skipped.
- **`document.freshness.cycle.completed`:** a summary. Freshness work lives in the freshness state and hold files that the fence reads.
- **`knowledge.instruction_capture.cycle.completed`:** a summary. Captured work lives in the capture queue that the fence lists.

These types never enter the fence's event head. The event watch on the CLI host and on a Node worker wakes the resident on `residentWakeKey`: the fence's event head plus its knowledge outbox counts and earliest due time. A wake therefore means the next cycle can see a change. A stage that another command records still wakes the resident through the successor job it enqueues, and an unreadable outbox falls back to the event head alone. `OutboxStore.latestHashExcluding(types)` reads the head from SQLite without decoding a row. A store without the typed read reports the unfiltered head, so a resident can only wake more often than needed, never less.

Every other event type still wakes the resident at once, for example:

- convergence obligations and owner changes;
- candidate exchange and captured candidates;
- materialization;
- owner turns, Hub imports, and user commands.

The listed types are ignored whoever appends them, because their follow-up reaches the resident through the same outbox and state either way.

### A freshness cycle with no news records nothing

A freshness cycle over the same findings records its event only when it is news: something was admitted, generated, verified, applied, or spent, or its outcome differs from the last recorded one. The freshness state keeps `lastOutcomeDigest`, the digest of the last recorded payload without its cycle identity and time. A deferral without progress still records nothing, as in ADR-0580.

A due debt retry reopens the stage only when today's budget can pay for one candidate, as ADR-0580 already requires for a pending review. The day is part of the stage's fence, so the next UTC day reopens it with a new budget. A due cross-check retry or an expired zero-success hold still reopens the stage, because neither needs today's generation budget.

### An admission waiter keeps one connection and backs off

An admission wait opens the host admission database once and reuses the connection for every poll, so the pragmas and table checks run once per acquisition. A connection that cannot open is opened again at the next poll. The wait between polls doubles from the base poll up to eight times it, and never past 8 seconds. With the existing jitter of plus or minus 25 percent, a waiter's heartbeat stays within 10 seconds, a third of the 30-second stale bound, so a backed-off waiter keeps its turn. Admission order, leases, renewal, confirmation and release are unchanged.

## States, events, privacy, and failure meaning

- **New state:** `lastOutcomeDigest` in `.lervo/state/knowledge/freshness-cycle.json`. It is an optional, rebuildable digest of counts, with no paths or text; a missing value records the next quiet cycle once.
- **No new event types or payload fields.** Fewer `document.freshness.cycle.completed` events are appended.
- **Failure meaning:**
  - A store that cannot read the filtered head falls back to the full head.
  - A failed head read still wakes the resident, as before.
  - An admission database that fails to open is retried at the next poll, and a non-contention failure still names the database.

## Consequences

- **Expected CPU:** an idle owner such as plen should fall from about 13 percent to about 1 percent. An owner stuck in `attention_required` cycles only at the forced 60-minute cap or on a real change. These numbers are estimates until a profile of the installed release confirms them.
- **Next stage timing:** unchanged. A completed stage enqueues its successor, which moves the outbox part of the wake key, so the resident still wakes for real follow-up work. Only a record with no new or rescheduled work stays silent.
- **Repeated retries:** a stage record alone no longer wakes the resident, but a retry that reschedules its delivery still does, because that is due work. flemo's `source_bytes_changed` retries are therefore bounded by their own retry schedule, not removed; whether that schedule backs off enough is checked on the installed release.
- **Freshness history:** a quiet repeated cycle leaves no event, so the event log shows changes in the freshness outcome rather than every observation. The freshness state still records `lastCycleAt` each time.
- **Admission timing:** a waiter that has polled for a while takes up to 10 seconds to notice a released admission, instead of about 1 second.
- **Follow-ups:**
  - The freshness dependency check still spawns one `git` process per dependency object. Batching them into one `git cat-file --batch-check` is the remaining freshness cost.
  - ADR-0461 carries no back-link to this record, because one more line would push it past the 16 KiB document limit.

## Verification

- **`packages/repository-knowledge-runtime/test/resident-authored-events.test.ts`:**
  - the type set names only outcome records;
  - those records, including a repeated stage record, leave the fence head unchanged, and a foreign event moves it;
  - the watch never wakes for them, and wakes for a foreign event and for a stage recorded by another command with its successor job;
  - an unreadable outbox wakes on the event head alone;
  - a store without the typed read falls back to the full head.
- **`packages/repository-knowledge-runtime/test/loop.test.ts`:** while only freshness cycle records are appended, a resident runs no full cycle and its idle streak keeps growing; a repository edit still runs it in full.
- **`packages/repository-knowledge-runtime/test/freshness-quiet-cycle.test.ts`:**
  - a quiet cycle with plen's payload records once and then nothing while it repeats;
  - a changed outcome, new findings, or progress records again;
  - a deferral without progress records nothing;
  - a due debt retry counts only when affordable, and an expired zero-success hold still counts.
- **`packages/event-store-sqlite/test/event-store.test.ts`:** `latestHashExcluding` skips excluded types and equals `latestHash()` with no exclusions.
- **`packages/repository-knowledge-runtime/test/full-cycle-admission.test.ts`:** the poll doubles to 8 seconds and stays there, the jittered wait never exceeds 10 seconds, and a short test poll backs off relative to itself. The existing admission tests cover order, contention and release with the reused connection.
