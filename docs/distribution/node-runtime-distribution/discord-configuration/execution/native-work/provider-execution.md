# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables` values configure the selected CLI. The model selection (ADR-0612) chooses models and efforts by role at each call; `lervo model show|set|unset` changes it. Configured `models` and `reasoningEfforts` apply only while a role is unset.

Provider contracts:

- [Turn deadlines, checkpoints, sessions, and replay](provider-execution/turn-lifecycle.md)
- [Semantic allocation and provider continuity](provider-execution/semantic-allocation.md)
- [Process environment and activation validation](provider-execution/runtime-validation.md)
