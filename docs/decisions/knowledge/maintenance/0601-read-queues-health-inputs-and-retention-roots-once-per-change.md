# ADR-0601: Read queues, health inputs, and retention roots once per change

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0597](0597-keep-idle-and-non-owner-residents-off-the-repository.md) (the retention gate and the non-owner wake), [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md) (the wake key's outbox read), [ADR-0599](0599-read-health-history-incrementally-and-fence-non-owners-without-git.md) (the health prefetch's remaining inputs)
Related: [ADR-0534](../../operations/storage/0534-bound-installed-runtimes-and-convergence-artifacts.md), [ADR-0584](../../operations/storage/0584-let-cas-retention-finish-a-pass-on-a-live-host.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

v0.29.7 made the health history incremental and the non-owner fence Git-free, as ADR-0599 intended. The Mac knowledge host still used about 15 percent of a core while it owned none of its repositories.

A 10-minute CPU profile on 2026-11-20 recorded about 300 busy seconds on the main thread. The active terminal session in one repository caused at most 20 of them. The rest was idle work:

1. **Health prefetch, about 100 seconds.** Every refresh rebuilt the repository layout plan. That plan decodes every concept and document normalization record as YAML and scans the repository. The refresh also walked the whole repository twice for its snapshot. It ran at the 15-minute age refresh for six repositories in the window, about a minute each.
2. **The wake key's outbox read, about 30 seconds plus most of the decoding and GC.** Each check listed up to 1,000 pending rows per knowledge destination and decoded every event. On this non-owner the backlog was never drained: 743 deliveries for axli dated from October.
3. **Artifact retention, about 13 seconds.** Any new event broke the ADR-0597 "head unchanged" gate. Retention then replayed the whole event log for its roots, 34,000 events for lervo. Terminal events from an active session move the head every few minutes, so the replay repeated.

## Decision

### Read the outbox as one aggregate

The storage contract gains an optional `OutboxStore.outboxSummary(destinationId)`. It returns the outstanding count, the earliest `availableAt` of an unleased delivery, and the earliest lease expiry of a leased one. SQLite answers it from one `COUNT`/`MIN` over the outbox table and decodes no row. The queue observation uses it when the store has it. A store without it is listed as before, where a truncated page still reports work as already due.

### A non-owner ignores the outbox it never drains

The three destinations a resident observes, `knowledge:convergence`, `knowledge:repository`, and `knowledge:repository:requeue`, are drained only by the convergence owner. A non-owner cycle claims none of them (ADR-0597). When this host's last ownership verdict is not owner, the wake key and the cycle fence leave them out, so a backlog the owner drains elsewhere never wakes a non-owner. A host without an ownership verdict, and every owner, reads them as before. A role change still moves the fence through the ownership fingerprint, and the resident observes ownership on its own cadence.

### Health reuses the layout plan until its inputs change

A long-lived resident keeps the last layout plan per repository. It reuses the plan while its key is unchanged, for at most an hour. The key is:

- the repository snapshot revision, which covers every file the plan scans and every store under `.lervo/knowledge`;
- the identity of the candidate stores under `.lervo/state/knowledge`, which the plan reads and the snapshot excludes.

An unreadable key, a failed plan, or the hour bound recomputes. The hour bound covers inputs the key cannot see, such as a path a custom knowledge policy reads but the snapshot excludes. A recomputed plan reuses concept decoding by content through the existing concept sidecar cache. It also skips decoding normalization records whose content was already seen at a later schema version. Every file's bytes are still read and every concept is still validated.

The refresh captures the repository snapshot once. The second capture guarded against a racing edit by not publishing. The projection already carries the revision captured before any read, and readers compare it with the current revision, so a projection made during an edit reads as an earlier revision and never as current.

### Retention reads roots and idleness from new events only

An event that is not a convergence record, not an `assignment.*` event, and names no assignment takes part in no artifact lifecycle. A full replay only adds the references in its payload to the roots. Retention therefore extends its last replay by such events alone. It replays the whole log again for:

- any lifecycle event;
- a gap in the chain or more than a page of new events;
- a new store;
- six hours since the last replay.

Every unlink is still fenced on the exact head (ADR-0584).

Eligibility arises only from a lifecycle event or from the grace horizon. A recorded idle answer therefore stands through events outside any lifecycle. The idle record gains the head's sequence, so later events can be checked, and the six-hour recheck still covers the horizon. Skipping a pass can only delay collection, never remove a referenced object.

## States, events, privacy, and failure meaning

This decision adds no event type. `outboxSummary` is an optional read on the storage contract. The retention idle record gains an optional `seq`, the head's sequence; a record without it behaves as before. The layout plan, concept decoding, normalization record versions, and retention roots are kept only in process memory. They hold nothing that is not already in the repository's own stores.

Every failure keeps the previous, more expensive behavior:

- A store without the aggregate is listed.
- An unreadable outbox wakes on the event head alone (ADR-0598).
- A key that cannot be computed recomputes the plan.
- A chain gap or an unexpected page replays the whole log.

## Consequences

- An idle non-owner decodes no outbox row, rebuilds no layout plan while its repository is unchanged, and replays no event log for terminal activity.
- Health shows a layout change in a path the snapshot excludes up to an hour late.
- Artifact collection on a host whose events are all outside any lifecycle can wait up to six hours longer than before. That host has nothing newly eligible to collect.
- **Follow-up:** the stale backlog in a non-owner's own outbox, such as axli's 743 deliveries from October, still grows its event store. Acknowledging or compacting deliveries whose owner is elsewhere needs its own decision.
- **Follow-up:** batching the freshness dependency checks into one `git cat-file --batch-check` (ADR-0598) and the owner's shared scan per cycle (ADR-0595 Change 3) remain owner-side work.

## Verification

- `packages/event-store-sqlite/test/outbox.test.ts`: the summary equals the listing for pending, leased, acknowledged, and other-destination rows.
- `packages/repository-knowledge-runtime/test/resident-authored-events.test.ts`:
  - the queue reads one aggregate per destination and lists no delivery;
  - a non-owner's wake key ignores an owner-drained backlog and still moves for a foreign event;
  - a non-owner watch stays asleep through its backlog.
- `packages/repository-knowledge-runtime/test/cas-retention-memo.test.ts`:
  - an extended view equals a full replay;
  - a lifecycle event, a long gap, and the six-hour bound replay the whole log;
  - an idle answer stands through events outside any lifecycle and ends at a lifecycle event or the recheck.
- `apps/cli/test/repository-health-layout.test.ts`:
  - the plan is recomputed only for a new revision, a changed candidate store, or the age bound;
  - a failed plan is never remembered.
- `packages/repository-knowledge/test/normalization-record-version.test.ts`: a later-version record is decoded once per content.
