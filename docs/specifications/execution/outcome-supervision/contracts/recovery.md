# Wakeups and recovery

Canonical assignment, handoff, run-terminal, verification, policy, membership, and user-request changes identify affected owners. Subscribe through durable causal relationships rather than mentions or channel speakers. Worker failure wakes its owner even without a reply. Central coordination wakes for assigned escalations, cross-team dependencies, or portfolio changes rather than every tool event.

Use a replaceable wakeup port with advisory hints and the earliest persisted deadline. Compose with ADR-0397's committed-head observation and bounded reconciliation. Its current Hub topics are only workstream and command; supervision routing requires an explicit extension. Hints never grant authority. Healthy unchanged cycles invoke no model and do not replay full history. Deadline checks, lease renewal, and missed-event recovery still use bounded waits.

Establish listeners before re-reading committed cursors and waiting. Restart, missed hints, cross-process writes, reconnect, and eviction recover from validated durable anchors. Divergent histories block affected admission; supervision does not reconcile forks. One serialized decision lease per supervision ID and exact-revision admission suppress duplicate owners. Independent assignments retain existing workspace/path concurrency rules.

Apply the minimum of mandate and existing graph, workforce, scheduler, provider, and workspace limits. Proposed initial defaults:

- 256 assignments per goal.
- 32 additions per decision.
- 8 outstanding escalations per goal.
- 3 recovery decisions per failed assignment.
- One coalesced pending wakeup per owner.

Limits stop new admission with attention, never drop evidence. Projections remain bounded; history uses existing event/CAS retention, not one tracked file per run. Revocation stops new effects; existing cancellation and uncertain-effect recovery handle in-flight work.
