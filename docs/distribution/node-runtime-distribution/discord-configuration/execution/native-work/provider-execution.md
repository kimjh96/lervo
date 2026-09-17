# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure the selected CLI. Optional `routing.workTimeoutMs` limits a turn to 10 seconds–30 minutes; the default is 30 minutes. The provider receives an exact finalization-start time with a bounded reserve and must checkpoint after its first material edit. Reaching the hard deadline is `provider_turn_timeout` even when a CLI exits zero or emitted intermediate prose; intermediate commentary is never accepted as a completed result.

Optional `remoteCommands.providerHost.executionProfiles` enables semantic allocation. It must define `routine`, `reasoning`, and `review`. Each profile declares a `preferredProvider` and a `providers` map whose routes contain an optional model and required reasoning effort. Routine requires `low` or `medium`; reasoning and review require `high`, `xhigh`, or `max`. When Codex and Claude are both allowlisted, reasoning and review must prefer different providers. This lets routine work use a balanced route while design, judgment, and review use higher-quality routes without concentrating every new turn on Codex.

The preferred provider applies only to a new unbound session. Existing provider sessions and explicitly provider-bound named agents retain identity, using the matching route for the selected quality profile. Missing matching routes fail closed. Completion telemetry records the profile and allocation reason alongside the exact requested model and effort.

A completed conversation or thread resumes the same opaque provider session for that hired agent. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

Replaying a running source event, including after the database reopens, retains the original attempt without starting another provider process. Its acknowledgement confirms duplicate suppression, not that the earlier process is still alive. Admission and replay inspection share one SQLite transaction. Conflicting identities or content are rejected without changing the original turn.

The runtime prepends its Node executable directory to the provider process `PATH`, allowing an absolute Codex launcher using `#!/usr/bin/env node` to run under a minimal systemd environment. Codex receives the exact Git common directory as an additional repository-owned writable root so `.git` sandbox protection does not block Lervo workstream bookkeeping.

Provider version preflight applies the same Node-directory `PATH` rule but exposes only `PATH` to the probe. Without this rule, a valid stored login can pass while the version probe incorrectly reports `probe_failed` for an `env node` launcher, preventing supervised owner decisions from starting. The login probe and actual provider process retain separate environment contracts.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.
