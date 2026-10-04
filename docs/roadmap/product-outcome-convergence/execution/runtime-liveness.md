# Runtime liveness through heartbeats

State: `wired`

Evidence:

- Direct worker writers record bounded last-seen observations.
- Root agents record explicit v2 heartbeat events without mutating identity or releasing authority.
- Managed adapters emit separately bound v2 provider-process observations after start, after terminal turns, and after stream drainage before shutdown.

`application liveness` and protocol-v3 `operating_liveness.inspect` expose both evidence families as separate installed, read-only collections. Codex app-server directly reports owned child-process state; Codex Responses and Claude SDK preserve explicit unobservable gaps.

Preserve point-in-time and false-authority meanings. Add native process-state support only where provider transport exposes direct evidence. Never infer continued health or termination from root reports, session registration, recent events, silence, or unobservable results.
