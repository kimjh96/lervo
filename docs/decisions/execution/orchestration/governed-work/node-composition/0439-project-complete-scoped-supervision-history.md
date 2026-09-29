# ADR-0439: Complete scoped supervision history in Node composition

Status: `accepted`
Decision date: 2026-09-28

## Context

The installed Lervo supervisor repeatedly failed because its execution-history projection retained every repository event and exceeded 32 MiB. Background knowledge, terminal context, and unrelated historical execution contributed to that projection even when they supplied no fact for the bound workstream. Canonical event history is valid and must remain intact. Raising the limit or selecting a recent window would leave growth unresolved or discard older authority and resource evidence.

## Decision

The task source projects complete execution for the bound workstream. A first incremental reader retains complete `work.*`, `workstream.*`, `organization.*`, `assignment.*`, and `run.requested` metadata. The shared work-controller causal selector validates all recorded causal ancestry and selects complete work trees associated with the workstream, including descendants with a nullable workstream coordinate. Explicit workstream control references to `managedRunId` also retain their entire run. Available legacy request-to-workstream or request-to-assignment coordinates receive the same treatment; absent coordinates never establish an invented relationship.

A second incremental reader retains that complete metadata and every canonical event belonging to a selected run. It preserves exact original event objects, including older context, process observations, usage, verification, terminal results, and failures. It never rewrites payloads or treats a retained subset as a complete repository history. Every encountered canonical event, including unselected execution, still undergoes project, sequence, previous-hash, and event-hash validation.

A changed run selection rebuilds the execution projection from the beginning. This backfills events preceding a later causal or control binding. Selection must agree with the metadata observed by the execution pass; at most 16 observation passes may resolve concurrent bindings. An unstable selection fails closed. Unchanged selections retain the existing incremental tail reads, detached results, sixty-second full audit, clock rollback handling, and exact database inode checks. Both projections retain the existing 100,000-event source bound and 32 MiB retained-byte bound. A complete selected scope exceeding either bound remains unsupported; no current-window truncation authorizes a result.

Peer observation uses the existing authority projection because it reads mandate, organization, and workstream authority rather than native execution bodies. Task admission and effect authorization continue to independently recheck role, ancestry, capabilities, exact source digest, resource observations, pending decisions, and owner leases. The projection grants no execution, cleanup, write, or provider authority.

## State, privacy, and failure meaning

No canonical event, writer version, persistent file, or public state is added. Projections remain rebuildable in-memory readers. Their raw events stay local; public health retains bounded codes. Existing history integrity, replacement, source-bound, and retained-byte failures remain fail-closed. `supervision_history_scope_unstable` means concurrent canonical bindings did not stabilize within the unchanged observation-pass allowance; no task facts or effect may be admitted from that observation.

This change does not solve complete execution-evidence compilation's separate 16 MiB corpus bound, establish complete knowledge currency, settle an uncertain run, fabricate usage, or clear a native provider pause.

## Verification

Focused tests compare managed attempts and both providers' resource accounting against complete history after an unrelated corpus crosses the old 32 MiB projection bound. They retain complete nullable-scope descendants and explicitly linked historical runs, backfill late bindings and concurrent changes, reuse detached incremental projections, reject unselected historical corruption on audit or clock rollback, reject malformed unrelated causal ancestry, and preserve database replacement and sequence bounds. Existing authority, owner recovery, task admission, dispatch, completion, peer, and resource suites remain required. Installed supervisor recovery must be observed independently from conversation readiness and knowledge currency.

## References

- [Durable supervision storage](../../../../../specifications/execution/outcome-supervision/implementation/storage.md)
- [Supervision knowledge readiness](../../../../../specifications/execution/outcome-supervision/implementation/knowledge-readiness.md)
- [ADR-0437](../../../../knowledge/repository/0437-stream-validated-recent-execution-evidence.md)
- [Autonomous background convergence](../../../../../roadmap/knowledge/autonomous-background-convergence.md)
