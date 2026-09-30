# Provider execution and continuity

`command.provider` selects Codex or Claude for native repository work. Matching `remoteCommands.providerHost.executables`, `models`, and `reasoningEfforts` values configure the selected CLI.

Provider contracts:

- [Turn deadlines, checkpoints, sessions, and replay](provider-execution/turn-lifecycle.md)
- [Semantic allocation and provider continuity](provider-execution/semantic-allocation.md)
- [Installed PO fleet model policy](provider-execution/fleet-model-policy.md)
- [Process environment and activation validation](provider-execution/runtime-validation.md)

The installed PO fleet's reviewed model policy is [versioned separately](../../../../../../scripts/distribution/po-model-policy.json) from agent identity and repository authority.
