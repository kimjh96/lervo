# ADR-0554: Bound what a reader retains, never history length

Status: `accepted`
Decision date: 2026-11-01
Amends: [ADR-0507](0507-verify-event-history-at-the-point-of-use.md) (reader bounds), [ADR-0403](../../knowledge/repository/0403-expand-execution-event-source-capacity.md) (the execution-event source selects a recent window instead of failing)

## Context

[ADR-0507](0507-verify-event-history-at-the-point-of-use.md) made the store verify the rows it returns. A reader that depends only on certain event types uses a typed read. A reader that must prove a complete project snapshot streams it with `visitEventSnapshot`.

Many readers did not follow that split, and about 25 sites added a bound on history length:

- **Retain everything.** `collectProjectEventsBounded` keeps every event of every type in memory, then the caller filters by type. It throws `event_limit_exceeded` above `maximumEvents`, which was 100,000 at every product site.
- **Bound the head.** `VerifiedEventTail`, the supervision authority history, the verification and execution-event evidence sources, and several other readers compare the store head sequence with 100,000. They fail once the head is above it, whatever they actually read.

On 2026-11-01, the WSL `lervo` store reached 100,996 events. Most were terminal and knowledge observations: 25,963 `context.selected` and 24,218 `document.loaded`. Two failures followed:

- The Node runtime failed at startup with `The supervised request history exceeds its observation bound` and restarted in a loop. Discord conversation, synchronization, and supervision stopped for that repository.
- `lervo upgrade` reported the knowledge stage blocked with `knowledge_evidence_source_invalid`.

History is append-only and canonical, so every repository reaches any fixed length bound eventually. The next largest stores held 46,281 events (Mac `argo`) and 37,500 (WSL `shiflo`).

Measurements on a copy of that 100,996-event store:

| Read                                                                                         | Result         | Cost  |
| -------------------------------------------------------------------------------------------- | -------------- | ----- |
| Stream the whole chain with `visitEventSnapshot`, verifying every link and retaining nothing | 100,996 events | 1.6 s |
| Typed read of `work.supervision.bound` and `workstream.snapshot.recorded`                    | 687 events     | 32 ms |
| Last 1,000 events                                                                            | 1,000 events   | 8 ms  |

Retaining the whole history took about 330 MB of resident memory.

## Decision

No reader fails because history is long. A bound limits what a reader retains, never the head sequence or the total length of history.

### Typed readers bound their matches

A reader whose answer depends only on certain event types reads exactly those types with a typed read. Its bound counts the matched events it retains, or their bytes. A reader that already has a typed incremental cursor, such as `VerifiedEventTail`, bounds the matched events it has observed, not the head.

### Snapshot readers stream and retain only what they use

A reader that must prove a complete project snapshot streams it with `visitEventSnapshot`. This verifies every predecessor link without retaining history. It keeps only the event types its answer uses, and its bound applies to those retained events. The CAS reference inventory is one such reader: every payload can name an artifact, so it streams the snapshot through the observed head and bounds the distinct references it retains.

Long-running processes keep their existing anchors: an in-memory cursor verifies appended events from the anchor, and a periodic full audit re-proves the chain below it. Complete traversal therefore costs time linear in history at most once per audit interval, and memory stays independent of history length.

### Windowed sources select instead of failing

A knowledge evidence source that can hold only a bounded window selects a deterministic window for the observed head: the most recent matching events within its count and byte limits. It does not fail. Verification results keep the 256 verifications with the most recent completions, admitted newest first within 16 MiB, and conflicting completions are still rejected for every returned verification.

The knowledge scan counts repository files first. Evidence sources beyond the policy's file count are skipped for budget and reported in `skippedForBudget`, instead of failing the scan with `knowledge_source_limit_exceeded`.

`collectProjectEventsBounded` remains only where a bounded snapshot is genuinely the input, such as tests and fixtures. Product readers do not use it to filter by type.

### Projections declare the types they read

A projection that receives event arrays exports the exact event types it consumes, next to its code: managed attempts, resources, stages, completion evidence, work topology, organization, and work scope. Readers pass those lists to a typed read. A test proves that each projection returns the same answer from the typed read as from the whole history with noise events of every other type. When a projection must check an event that a typed read does not return, such as the review and source events that an agent-context promotion names, it looks the event up by ID within the observed head.

### Another workstream's completion evidence is its own

Governed-work inspection checked every `assignment.completion.prepared` event against the current workstream's attempts. On the WSL store these events belonged to more than ten workstreams, so inspection failed for every workstream whatever history length. A preparation is now checked only by the projection of the workstream it names. A preparation that names this workstream still fails closed on any mismatch.

## Events, states, privacy, and failure meaning

- No event, state, or schema changes. Readers return the same answers for histories under the old bound.
- Fail-closed checks stay in force: row hashes, forward order, predecessor links in snapshot traversal, conflicting authority or verification events, revocations, and replaced or rolled-back stores.
- The scoped supervision execution history retains every event of the runs its workstream selects, under a 32 MiB bound. On the WSL store it held 11,380 events (13 MB). A workstream that keeps running long enough will reach it. The bounded follow-up is to retain settled runs as their outcome rows rather than every event, verified by a test that a workstream with more than 32 MiB of settled run events still projects.
- An execution-event window that leaves older events out reports it only through `ExecutionEventWindow.complete()`; knowledge outputs do not yet carry it. The bounded follow-up is a `window: complete | partial` field on the evidence coverage of the knowledge scan, verified by a test with more events than the window holds.
- A reader whose retained matches exceed its bound still fails with its existing error. That bound now measures the data the reader holds, so reaching it means the reader needs a narrower selection, not a shorter history.

## Verification

Focused tests must show, for every changed reader, that a store whose head is above 100,000 events with few matching events produces the same answer as a short store, and that tampering, conflicts, and revocations still fail closed.

Installed verification must show, on the WSL `lervo` store with more than 100,000 events:

- the Node runtime starts and reports sync, workstream replication, remote control, conversation, and supervision as ready;
- `lervo upgrade` reaches `current`, with the knowledge stage no longer blocked by `knowledge_evidence_source_invalid`.
