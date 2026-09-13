# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `installed acceptance required`.

- [Participation contract](multi-party-conversation/participation.md): participant binding, channel composition, authority constraints, and provider selection.
- [Installed scope](multi-party-conversation/installed-scope.md): deployment behavior, implemented capabilities, organization topology, and remaining work.

## Acceptance

One real channel with one person and at least two hired agents in distinct roles must:

- Inspect requested code and complete authorized real work.
- Use threads, replies, and mentions as needed.
- Complete a bounded discussion and stop at its declared terminal condition.
- Preserve every participant, role, provider-model, and agent-context coordinate across restart.
- Produce no unauthorized repository or external effect.

The same scenario must be replayable through a non-Discord test surface over shared application contracts.

## References

- [ADR-0384](../../../../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md)
- [ADR-0385](../../../../decisions/coordination/conversations/0385-distinct-discord-agent-identities.md)
- [ADR-0386](../../../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md)
- [ADR-0387](../../../../decisions/coordination/conversations/0387-terminal-conversation-response-failures.md)
- [ADR-0391](../../../../decisions/coordination/conversations/0391-deterministic-multi-agent-turn-ownership.md)
- [ADR-0392](../../../../decisions/coordination/conversations/0392-installed-proactive-signals-and-deliberation.md)
- [ADR-0393](../../../../decisions/coordination/conversations/0393-named-agent-identity-and-installed-organization-effects.md)
- [ADR-0394](../../../../decisions/coordination/conversations/0394-webhook-backed-discord-agent-identities.md)
- [ADR-0395](../../../../decisions/coordination/conversations/0395-resumable-native-repository-work-turns.md)
- [ADR-0396](../../../../decisions/coordination/conversations/0396-conflict-safe-repository-replica-continuation.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
