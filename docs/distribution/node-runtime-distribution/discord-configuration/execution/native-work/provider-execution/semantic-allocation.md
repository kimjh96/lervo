# Semantic allocation and continuity

Optional `remoteCommands.providerHost.executionProfiles` enables semantic allocation and must define `routine`, `reasoning`, and `review`.

Each profile declares a `preferredProvider` and a `providers` map. Each route contains an optional model, required reasoning effort, and optional `timeoutMs` from 10 through 300,000 milliseconds.

- Routine requires `low` or `medium` effort.
- Reasoning and review require `high`, `xhigh`, or `max` effort.
- When Codex and Claude are both allowlisted, reasoning and review must prefer different providers.

The selected route's timeout applies to managed conversation work and provider transport, so slower high-effort review is not constrained by the routine response budget. These profiles let routine work use a balanced route and design, judgment, and review use higher-quality routes without concentrating every new turn on Codex.

The preferred provider applies to each new unbound source event, including independent review after another provider's work. Provider-specific sessions remain separate and resumable. Only an explicitly provider-bound named agent overrides the profile preference.

A replayed source event retains its originally admitted provider. Without a semantic profile, the most recent provider session retains legacy continuity behavior. Missing matching routes fail closed.

Completion telemetry records the profile and allocation reason alongside the exact requested model and effort.
