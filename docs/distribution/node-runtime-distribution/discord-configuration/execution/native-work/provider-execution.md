# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure the selected CLI. Optional `routing.workTimeoutMs` bounds a turn from 10 seconds to 30 minutes and defaults to 15 minutes.

A completed conversation or thread resumes the same opaque provider session for that hired agent. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

Replaying a running source event, including after the database reopens, retains the original attempt and does not start another provider process. Its acknowledgement reports duplicate suppression, not proof that the earlier process remains alive. Admission and replay inspection share one SQLite transaction. Conflicting identities or content are rejected without changing the original turn.

The runtime prepends its Node executable directory to the provider process `PATH`. This allows an absolute Codex launcher using `#!/usr/bin/env node` to run under a minimal systemd environment. Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

Provider version preflight uses the same Node-directory `PATH` rule while exposing only `PATH` to the probe. Otherwise a valid stored login can pass while the version probe incorrectly reports `probe_failed` for an `env node` launcher, preventing supervised owner decisions from starting. The login probe and actual provider process retain their separate environment contracts.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.
