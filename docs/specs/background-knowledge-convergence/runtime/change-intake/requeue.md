# Re-queue of stalled jobs

Every worker run—CLI or Node, legacy or v4—first calls `requeueStalledRepositoryKnowledgeJobs`. It re-queues each change once when its latest resolution is `attention_required` and either condition holds:

- Its failure code is `review_source_limit_exceeded`, `repository_change_path_limit_exceeded`, or `asset_verification_required`, caused by whole-job intake rejection.
- Its failure code is `review_needs_attention` and the resolution predates ADR-0457, identified by missing `subJobCount`. The v4 placeholder reviewer produced these resolutions.

The original change event is enqueued under the separate `knowledge:repository:requeue` destination, drained after new jobs. Its resolution has a distinct deterministic event ID and `supersedesResolutionEventId`; its review budget starts fresh. A change with a superseding resolution is never re-queued again. Historical resolutions are never rewritten.

The scan position lives in `.lervo/state/knowledge/requeue-cursor.json`, a rebuildable projection bound to an event sequence and hash. Losing the file or renumbering the store only repeats an idempotent scan.

Re-queued and new jobs share the 1,024-job outstanding ceiling. A full queue defers the remainder and leaves the cursor in place.
