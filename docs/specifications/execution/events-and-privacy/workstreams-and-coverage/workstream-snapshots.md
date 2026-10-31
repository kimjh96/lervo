# Workstream snapshots

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths.

The local projection is written lazily under `.lervo/state/workstreams/` and follows the checked-out branch through the local `bindings.json` selection ([ADR-0526](../../../../decisions/execution/orchestration/governed-work/workstream-concurrency/0526-bind-workstreams-to-branches.md)); exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.
