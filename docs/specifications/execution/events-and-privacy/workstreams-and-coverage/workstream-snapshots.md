# Workstream snapshots

`workstream.snapshot.recorded` retains workstream ID, monotonic revision, status, change kind, snapshot and previous hashes, content-addressed snapshot and optional legacy-source artifact IDs, and time. It excludes objective, tasks, blockers, notes, references, source bodies, prompts, credentials, and absolute paths.

The local projection is written lazily under `.lervo/state/workstreams/`; exact snapshots and migrated source bytes are CAS artifacts. Migration or update publishes files before recording the event and rolls them back if the event fails.
