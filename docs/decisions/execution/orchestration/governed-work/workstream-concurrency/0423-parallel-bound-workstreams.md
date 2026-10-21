# ADR-0423: Supervise bound workstreams independently of the selected workstream

- Status: accepted design; implementation and installed acceptance pending
- Decision date: 2026-09-19
- Amended by: [ADR-0526](0526-bind-workstreams-to-branches.md) (the selected projection follows the checked-out branch)

## Context

The installed Lervo project has a standing Elio supervision lineage and an active conversation-routing review with a blocking deployment approval. The single `.lervo/state/workstreams/current.json` projection selects the review. Supervision reads and commit fences treat that selection as the only admissible goal, leaving Elio's unchanged binding dormant.

Replacing `current`, cloning the project or agent, or changing the Discord deployment would displace the review or change who can speak. Reporting the Node as ready does not resume supervision.

## Decision

Keep one project, event journal, workforce registry, Elio agent ID, and installed Discord speaker binding. Treat `current.json` as the default human/CLI selection, not an authority grant or the only active workstream.

A supervised operation selects the workstream named by its reviewed mandate and binding, then verifies its latest canonical `workstream.snapshot.recorded` event and exact content-addressed snapshot. Its source digest and every effect fence include that workstream's ID, revision, snapshot hash, mandate, owner, workforce state, and relevant global event head. Changing an unrelated selected workstream must not deactivate the bound goal or change its source digest; a simultaneous append may cause an ordinary global event-head compare-and-swap retry. Changes to the bound goal or shared workforce still invalidate its source.

Updates to an unselected bound workstream use an exact predecessor hash and append a new snapshot artifact and event under the existing durable transaction. They must not overwrite `current.json`, clear another workstream's pending approval, or create a second task database. The selected workstream's existing update path remains compatible.

A standing successor derives only from its bound settled predecessor and reviewed successor grant. It must not use the selected review as its predecessor or silently change the human's selected workstream.

One owner may observe multiple active workstreams only when each has its own exact reviewed mandate, resource ceiling, scope, and owner fence. Admission serializes conflicting shared workforce and repository mutations. Parallel observation or independent work never implies parallel writes to overlapping paths. Scheduling remains bounded by installed provider and resource policy. Conversation focus, publication author, and Discord delivery binding remain independent of workstream selection.

The existing Hub workstream replication protocol has one selected head and does not publish an unselected bound branch. The selected review continues to replicate normally; unrelated bound events must not poison its local revision reader. A cross-host writer for the same unselected branch requires a separately reviewed multi-head replication protocol. This decision authorizes only the installed repository's single-writer event/CAS history, not an inferred Mac/WSL second writer.

The deployment approval stays on the review workstream until the specified installed two-direction, exactly-once evidence run correlates normal, redelivered, failed, retried, and restarted requests with inbox, participation, outbox, focus, and observed Discord publication. Component tests, a bot-authored substitute for a human request, and Elio's resumed supervision cannot satisfy that gate.

## Failure, privacy, and compatibility

Repository-scoped Hub replication transfers an exact head, not every intervening revision. The bound reader accepts a sparse `hub_replication_import` only after verifying its content-addressed snapshot and event coordinates. Subsequent local revisions must be contiguous from that checkpoint. This does not claim transfer of missing intermediate snapshots. Any other gap is an incomplete-history failure.

No new event type is required. The existing snapshot event must contain the exact workstream ID, revision, status, content hash, predecessor hash, and recorded time. Its artifact contains bounded workstream prose under the existing project data policy.

Missing, corrupt, forked, stale, or wrong-project snapshots fail closed with a bounded source error and no effect. Accept the legacy selected projection only when its hash matches canonical history. Existing single-workstream repositories continue through the selected path until their bound-state projection is available. Workstream events must exclude credentials, message bodies, provider output, and Discord tokens.

## Acceptance

1. With review A active and approval held, supervision bound to Elio goal B reads B's canonical head and performs an authorized owner cycle. A and its approval remain byte-for-byte unchanged.
2. Interleaved A and B revisions preserve separate predecessor hashes, reject stale or forked B effects, and survive Node restart in the installed single-writer repository. Selected-head Hub replication remains valid with an interleaved bound B event; cross-host writes to B are not claimed.
3. Completion and standing succession of B leave A selected and retain the same Elio identity, mandate lineage, and existing Discord bot principal. No clone or shadow webhook appears.
4. Shared assignment/path conflicts, expired or revoked mandates, incomplete evidence, and uncertain provider effects block only their authorized scope without crossing approval or goal boundaries.
5. The installed two-direction conversation acceptance matrix passes before the review's deployment approval is resolved. A human-authored Discord source and exact publication receipts are required.

## References

- [Standing lineage](../0405-standing-supervision-lineage.md)
- [Outcome supervision](../../../../../specifications/execution/outcome-supervision.md)
- [Real authorship and focus](../../../../coordination/conversations/0419-preserve-human-focus-and-real-agent-authorship.md)
- [Installed conversation scope](../../../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation/installed-scope.md)
