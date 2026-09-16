# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure the selected CLI. Optional `routing.workTimeoutMs` limits a turn to 10 seconds–30 minutes; the default is 15 minutes.

A completed conversation or thread resumes the same opaque provider session for that hired agent. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

Replaying a running source event, including after the database reopens, retains the original attempt without starting another provider process. Its acknowledgement confirms duplicate suppression, not that the earlier process is still alive. Admission and replay inspection share one SQLite transaction. Conflicting identities or content are rejected without changing the original turn.

The runtime prepends its Node executable directory to the provider process `PATH`, allowing an absolute Codex launcher using `#!/usr/bin/env node` to run under a minimal systemd environment. Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

Provider version preflight applies the same Node-directory `PATH` rule but exposes only `PATH` to the probe. Without this rule, a valid stored login can pass while the version probe incorrectly reports `probe_failed` for an `env node` launcher, preventing supervised owner decisions from starting. The login probe and actual provider process retain separate environment contracts.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.
