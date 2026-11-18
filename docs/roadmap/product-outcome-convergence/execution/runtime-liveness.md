# Runtime liveness through heartbeats

State: `wired`

Evidence:

- Direct worker writers record bounded last-seen observations.
- Root agents record explicit v2 heartbeat events without mutating identity or releasing authority.
- Managed adapters emit separately bound v2 provider-process observations after start, after terminal turns, and after stream drainage before shutdown.

`lervo agent heartbeat` records and `lervo agent inspect` reads root-agent liveness. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the combined `OperatingLivenessReportV1` query and its protocol route; both event families stay. Codex app-server directly reports owned child-process state; Codex Responses and Claude SDK preserve explicit unobservable gaps.

Preserve point-in-time and false-authority meanings. Add native process-state support only where provider transport exposes direct evidence. Never infer continued health or termination from root reports, session registration, recent events, silence, or unobservable results.
