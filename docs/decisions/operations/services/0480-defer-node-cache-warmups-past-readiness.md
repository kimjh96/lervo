# ADR-0480: Defer Node cache warm-ups past readiness

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0475](0475-judge-node-replacement-readiness-by-regression.md)

## Context

On the WSL host, `lervo upgrade --apply` for the `lervo` repository (main `bafdf86d`) failed its `repository_node` stage with `node_fleet_readiness_timeout`. The blockers were `sync=pending (baseline ready), workstreamReplication=pending, remoteControl=pending, conversation=pending, supervision=pending`. Rollback restored the predecessor correctly.

That Node has an event store of about 123 MB and a large repository. On every restart that day, `openNodeRuntime` took 78 to 85 seconds before the service journal printed `Lervo Node synchronization started.`. Examples are 23:27:45 to 23:29:07 and 17:34:37 to 17:36:01. Until that line, no component can report readiness. The sync loop, the remote-control loop, and supervision start only after `openNodeRuntime` returns. The health snapshot was published once as `starting` before the conversation runtime opened. It was not refreshed again until the first sync cycle.

A five-second V8 CPU profile of the main thread during that window was dominated by repository-knowledge index construction. It showed `lstat` (522 ticks), `fstat`, `terms`, `canonicalJson`, and `analyzeLexicalV2Field`. The caller is `openManagedConversationReadResponder`. It captured a repository snapshot and awaited `RevisionedRepositoryKnowledgeQuery.prepare` before it returned. That call opened project storage and verified the event chain, scanned repository knowledge, read every concept publication, and built the lexical-v2 ranker. The index is a rebuildable projection (invariant 4). A query already resolves or rebuilds it for its own snapshot revision, so readiness never depended on it.

ADR-0475 extends the readiness window only for a first fresh snapshot or for more accepted components. A live process that took longer than 60 seconds between the two therefore timed out, although it was still making progress.

## Decision

### Cache warm-ups run after readiness

The Node creates one deferred-work queue in `openNodeRuntime`:

- A task waits until the health aggregate first leaves `starting` for `ready` or `degraded`.
- If readiness never settles, a 120-second fallback releases the queue. A warm cache then still helps later turns.
- Tasks run one at a time. A failure writes one bounded line, `Lervo Node deferred work <name> failed: <code>`, and never fails the runtime. The code is a bounded identifier or `unknown`.
- Closing the runtime drops queued tasks and the fallback timer. A task that is already running finishes in the background.

`openManagedConversationReadResponder` no longer captures a snapshot or prepares the knowledge index before it returns. It schedules the `conversation_knowledge_index` task, which captures a snapshot and prepares the index for that revision. If the caller supplies no queue, the warm-up starts immediately in the background. Each managed read still captures a fresh snapshot and awaits the index for that revision. A turn that arrives before the warm-up waits for the build, which is the same as before this change. An index build failure now surfaces on that query instead of failing Node startup.

### Starting heartbeat

While the aggregate status is `starting`, the health publisher refreshes `updatedAt` every five seconds. The heartbeat starts after the first snapshot is published. It stops when the status becomes `ready`, `degraded`, or `stopping`, or when a write fails, and the startup failure path stops it too. The snapshot schema is unchanged. Only the refresh frequency of `updatedAt` changes. A blocked event loop delays the heartbeat, so a missing heartbeat still means the process is not making progress.

### Readiness observation

ADR-0475 progress gains one more source: an advancing `updatedAt` in a fresh `starting` snapshot from the first process identity seen `starting`. Such an advance extends the deadline to 60 seconds past that observation. The total stays bounded at 600 seconds (1,200 observations).

Liveness never counts in these cases:

- The status is `ready`, `degraded`, or `stopping`. A newly failed component makes the status `degraded`, so it still fails 60 seconds after the last progress, as before.
- A different process identity later reports `starting`. This means the replacement restarted or crashed, so liveness stops counting for the rest of the observation.
- `updatedAt` does not advance, as with a hung process or a crashed process that is not restarted.

## Privacy and failure meaning

The deferred-work failure line contains only the fixed task name and a bounded code. It contains no paths, queries, or document content. The heartbeat adds no fields. A heartbeat proves only that the process's event loop runs. It does not prove that any component is ready. The receipt and failure details of ADR-0475 are unchanged.

## Verification

Focused tests cover these behaviors:

- `openManagedConversationReadResponder` returns while a simulated knowledge index build never finishes, and runs that build only after the deferred queue is released.
- The deferred queue preserves order, reports a failure without stopping later tasks, releases on its fallback, and drops queued tasks after close.
- The health publisher advances `updatedAt` while `starting`, calls `onSettled` exactly once, and stops the heartbeat after readiness.
- Readiness observation accepts a live `starting` process that settles after 200 seconds. It still times out after a restart under a new identity, and it stops at 1,200 observations for a live process that never settles.

A local measurement on a copy of a 42 MB event store found that opening the read responder took 5,932 ms before this change and 597 ms after it. The 6,080 ms index warm-up then ran in the background.

Installed verification must show `lervo upgrade --apply` completing its `repository_node` stage for the WSL `lervo` repository.

## References

- [Judge Node replacement readiness by regression](0475-judge-node-replacement-readiness-by-regression.md)
- [Managed read composition](../../../specifications/coordination/conversation-runtime-composition/managed-reads.md)
- [Bounded offline replacement](../../../specifications/coordination/hub-and-node/runtime-lifecycle/bounded-offline-replacement.md)
