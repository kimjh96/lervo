# `execution.stages.observed`

Retains managed or unmanaged mode, an opaque work or terminal coordinate, nullable managed work ID, nullable terminal hook, observation and environment digests, repository profile, and at most 32 catalogued stage results.

Current managed producers use a null terminal hook. Current direct producers use `UserPromptSubmit` or `Stop`. Historical sets without this additive field remain readable but project with an unavailable hook coordinate.

The canonical local CAS environment profile contains build, nullable adapter and provider, OS, architecture, Node, corpus counts when observed, cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names.

Under [ADR-0531](../../../../../decisions/execution/providers/hooks/0531-bound-terminal-hooks-and-retain-degraded-context.md), `failureReason` is an optional closed code. Current failed hook producers require it. Recovered Stop inspection, checkpoint, or capture failures may also carry it on a completed observation without changing the completion decision. Historical records may omit it. `terminalHook` is omitted when ingress was rejected before its event could be trusted; opaque unattributed coordinates do not claim a provider session. Storage failure or an older writer can prevent recording, so missing telemetry is never success evidence.

The schema accepts `repository_snapshot_limit_exceeded`, `repository_snapshot_deadline_exceeded`, `repository_snapshot_failed`, `git_ignored_paths_unavailable`, `knowledge_inspection_failed`, `hook_deadline_exceeded`, `repository_discovery_failed`, `lifecycle_inspection_failed`, `event_persistence_failed`, `hook_input_invalid`, and `unexpected_error`. These describe the failed boundary, not developer task failure. No message, path, stack, prompt, or credential is allowed in this field.
