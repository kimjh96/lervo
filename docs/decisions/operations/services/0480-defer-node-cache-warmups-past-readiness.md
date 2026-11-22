# ADR-0480: Defer Node cache warm-ups past readiness

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0475](0475-judge-node-replacement-readiness-by-regression.md)
Amended by: [ADR-0611](../diagnostics/0611-judge-a-settled-node-by-its-process-not-its-snapshot-age.md) (a settled snapshot is current while its process runs)

## Context

On WSL, `lervo upgrade --apply` for the `lervo` repository (main `bafdf86d`) failed `repository_node` with `node_fleet_readiness_timeout`. Blockers were `sync=pending (baseline ready), workstreamReplication=pending, remoteControl=pending, conversation=pending, supervision=pending`. Rollback correctly restored the predecessor.

The Node has an event store of about 123 MB and a large repository. On every restart that day, `openNodeRuntime` took 78–85 seconds before the service journal printed `Lervo Node synchronization started.`; examples were 23:27:45–23:29:07 and 17:34:37–17:36:01. No component can report readiness before that line: the sync loop, remote-control loop, and supervision start only after `openNodeRuntime` returns. Health was published once as `starting` before the conversation runtime opened, then not refreshed until the first sync cycle.

A five-second main-thread V8 CPU profile during this window was dominated by repository-knowledge index construction: `lstat` (522 ticks), `fstat`, `terms`, `canonicalJson`, and `analyzeLexicalV2Field`. The caller, `openManagedConversationReadResponder`, captured a repository snapshot and awaited `RevisionedRepositoryKnowledgeQuery.prepare` before returning. This opened project storage, verified the event chain, scanned repository knowledge, read every concept publication, and built the lexical-v2 ranker. The index is a rebuildable projection (invariant 4). Queries already resolve or rebuild it for their snapshot revision, so readiness never depended on it.

ADR-0475 extended the window only for a first fresh snapshot or more accepted components. A live process taking over 60 seconds between those events therefore timed out despite ongoing progress.

## Decision

### Cache warm-ups run after readiness

`openNodeRuntime` creates one deferred-work queue:

- Tasks wait until the health aggregate first leaves `starting` for `ready` or `degraded`.
- If readiness never settles, a 120-second fallback releases the queue so a warm cache can still help later turns.
- Tasks run one at a time. Failure writes one bounded line, `Lervo Node deferred work <name> failed: <code>`, and never fails the runtime. The code is a bounded identifier or `unknown`.
- Closing the runtime drops queued tasks and the fallback timer. An already-running task finishes in the background.

`openManagedConversationReadResponder` returns without capturing a snapshot or preparing the knowledge index. It schedules `conversation_knowledge_index` to capture a snapshot and prepare the index for that revision. Without a caller-supplied queue, warm-up starts immediately in the background.

Each managed read still captures a fresh snapshot and awaits that revision's index. A turn arriving before warm-up waits for the build, as before. Index build failures now surface on the query instead of failing Node startup.

### Starting heartbeat

While aggregate status is `starting`, the health publisher refreshes `updatedAt` every five seconds. The heartbeat starts after the first snapshot is published and stops when status becomes `ready`, `degraded`, or `stopping`, or when a write fails. The startup failure path also stops it. It starts again whenever the status returns to `starting`, such as after a component was briefly unavailable; before that, one transient `degraded` froze `updatedAt` for the rest of a slow startup. A closed publisher never starts it again.

The snapshot schema is unchanged; only the refresh frequency of `updatedAt` changes. A blocked event loop delays the heartbeat, so a missing heartbeat still means the process is not making progress.

### Readiness observation

ADR-0475 gains another progress source: advancing `updatedAt` in a fresh `starting` snapshot from the replacement, the first process identity seen `starting` that is not the predecessor. A predecessor that was itself still `starting` writes fresh heartbeats until it stops; it is not the replacement and never counts. It is known by the process identity the readiness baseline recorded before the service operation, so a clock step cannot confuse the two. Only without an observed baseline is a process that started before the service operation taken for the predecessor. Before this, liveness latched onto such a predecessor and then treated the real replacement as a restart, so readiness ended 60 seconds after the last settled component. Each advance extends the deadline to 60 seconds after that observation. The total remains bounded at 600 seconds (1,200 observations).

Liveness never counts when:

- Status is `ready`, `degraded`, or `stopping`. A newly failed component makes status `degraded`, so it still fails 60 seconds after the last progress.
- A different process identity later reports `starting`, indicating a replacement restart or crash. Liveness stops counting for the rest of the observation.
- `updatedAt` does not advance, as with a hung process or a crashed process that is not restarted.

## Privacy and failure meaning

Deferred-work failure lines contain only the fixed task name and a bounded code, with no paths, queries, or document content. The heartbeat adds no fields and proves only that the process's event loop runs, not that any component is ready. ADR-0475 receipts and failure details are unchanged.

## Verification

Focused tests cover:

- `openManagedConversationReadResponder` returning while a simulated knowledge index build never finishes, and running the build only after the deferred queue is released.
- Queue ordering, failure reporting without stopping later tasks, fallback release, and dropping queued tasks after close.
- The health publisher advancing `updatedAt` while `starting`, calling `onSettled` exactly once, and stopping the heartbeat after readiness.
- Readiness observation accepting a live `starting` process that settles after 200 seconds, still timing out after a restart under a new identity, and stopping at 1,200 observations for a live process that never settles; and counting the replacement's heartbeat when the predecessor was still `starting`, also after a clock step back.
- The health publisher resuming the heartbeat after a component was briefly unavailable, and never after close.

On a local copy of a 42 MB event store, opening the read responder took 5,932 ms before this change and 597 ms after it. The 6,080 ms index warm-up then ran in the background.

Installed verification must show `lervo upgrade --apply` completing `repository_node` for the WSL `lervo` repository.

## References

- [Judge Node replacement readiness by regression](0475-judge-node-replacement-readiness-by-regression.md)
- [Managed read composition](../../../specifications/coordination/conversation-runtime-composition/managed-reads.md)
- [Bounded offline replacement](../../../specifications/coordination/hub-and-node/runtime-lifecycle/bounded-offline-replacement.md)
