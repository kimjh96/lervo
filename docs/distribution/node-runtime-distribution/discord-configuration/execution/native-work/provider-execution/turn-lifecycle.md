# Turn lifecycle and evidence

Optional `routing.workTimeoutMs` limits a turn to 10 seconds–30 minutes; the default is 30 minutes. The provider receives an exact finalization-start time with a bounded reserve and must checkpoint after its first material edit.

Reaching the hard deadline is `provider_turn_timeout`, even if the CLI exits zero or emits intermediate prose. Intermediate commentary never counts as a completed result.

If a provider returns a successful result with observed changed paths but leaves the baseline workstream revision unchanged, the Node may record one host recovery checkpoint on that same active or blocked workstream before completion verification. This does not make the provider CLI optional for crash safety. No host checkpoint is created for a missing, switched, completed, or cancelled workstream, or for a provider turn without a successful final result.

A completed conversation or thread resumes the opaque session for that hired agent and selected provider. Exact duplicate requests coalesce while active and reuse the recent result instead of running twice.

Replaying a running source event, including after the database reopens, retains the original attempt without starting another provider process. Its acknowledgement confirms duplicate suppression, not that the earlier process remains alive. Admission and replay inspection share one SQLite transaction. Conflicting identities or content are rejected without changing the original turn.

A message-scoped provider or dispatch failure follows the durable interaction failure path without stopping other configured Discord identities.
