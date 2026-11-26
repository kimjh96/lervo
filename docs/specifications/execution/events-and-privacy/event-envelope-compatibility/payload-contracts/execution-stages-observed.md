# `execution.stages.observed`

Retains managed or unmanaged mode, an opaque work or terminal coordinate, nullable managed work ID, nullable terminal hook, observation and environment digests, repository profile, and at most 32 catalogued stage results.

Current managed producers use a null terminal hook. Current direct producers use `UserPromptSubmit` or `Stop`. Historical sets without this additive field remain readable but project with an unavailable hook coordinate.

The canonical local CAS environment profile contains build, nullable adapter and provider, OS, architecture, Node, corpus counts when observed, cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names.

Under [ADR-0531](../../../../../decisions/execution/providers/hooks/0531-bound-terminal-hooks-and-retain-degraded-context.md), `failureReason` is an optional closed code. Current failed hook producers require it. Recovered Stop inspection, checkpoint, or capture failures may also carry it on a completed observation without changing the completion decision. Historical records may omit it. `terminalHook` is omitted when ingress was rejected before its event could be trusted; opaque unattributed coordinates do not claim a provider session. Storage failure or an older writer can prevent recording, so missing telemetry is never success evidence.

The schema accepts `repository_snapshot_limit_exceeded`, `repository_snapshot_deadline_exceeded`, `repository_snapshot_failed`, `git_ignored_paths_unavailable`, `knowledge_inspection_failed`, `hook_deadline_exceeded`, `repository_discovery_failed`, `lifecycle_inspection_failed`, `event_persistence_failed`, `hook_input_invalid`, and `unexpected_error`. These describe the failed boundary, not developer task failure. No message, path, stack, prompt, or credential is allowed in this field.

## Hook delivery (schema 13)

A terminal hook either runs inside the resident context server or in its own process. Schema 13 adds an optional `delivery` object that says which, so stage timings can be read against how the owner actually received the answer:

- `channel: context_server`: the server ran the hook, and `fallback` is refused. `answerMilliseconds`, between 0 and 600000, is present when the server answered before this record, as [ADR-0636](../../../../../decisions/execution/providers/hooks/0636-answer-a-served-prompt-before-recording-it.md) allows. It is the client's elapsed time when it sent the request plus the server's time from committing to the request to writing the answer: what the provider waited for, without the records that follow an early answer and without the connection's round trip. It matches `answerMilliseconds` in the server's `context-stats.json`. Without it, the answer was written after this record, or not at all.
- `channel: in_process`: the hook ran in its own process. `fallback` is required and `answerMilliseconds` is refused. `fallback` is one of:
  - `no_server`: no socket existed;
  - `declined_runtime_mismatch`, `declined_environment_mismatch`, `declined_busy`, `declined_request_too_large`, `declined_invalid_request`: the server declined for that reason;
  - `unreachable`: the socket existed but did not answer in time or refused the connection;
  - `disabled`: the socket path was switched off;
  - `not_offered`: the launcher did not offer this request, for example on a platform without the socket, for an oversized input, or for an unreadable runtime pointer;
  - `unreported`: the launcher reported no outcome, as an older launcher does.

No other key is allowed in `delivery`. It carries no path, socket name, prompt, or session data. An absent `delivery` claims nothing: older writers and hooks that recorded no delivery look the same. Below schema 13 the envelope refuses the field, so older readers never receive it.

This release only reads `delivery`; no writer records it yet.
