# Role-backed multi-party conversation

Part of [Discord remote continuation](../discord.md).

State: `delivery required`.

- [Participation contract](multi-party-conversation/participation.md): participant binding, channel composition, authority constraints, and provider selection.
- [Installed scope](multi-party-conversation/installed-scope.md): deployment behavior, implemented capabilities, organization topology, and remaining work.
- [Asynchronous conversation knowledge lifecycle](../../../knowledge/asynchronous-conversation-lifecycle.md): agent-owned canonicalization and refresh without live-response delay; implementation and installed acceptance remain required.

## Acceptance

One real channel with one person and at least two hired agents in distinct roles must:

- Inspect requested code and complete authorized real work.
- Use threads, replies, and mentions as needed.
- Complete a bounded discussion and stop at its declared terminal condition.
- Complete ordinary multi-agent discussion without implicitly starting formal deliberation, then pass a separate, explicit formal-decision journey in one bound thread.
- Route a task to the hired agent whose role owns it without the person naming that agent, and let the agent answer from its own context.
- Let one non-source agent autonomously join a materially relevant human or agent turn without a mention, while irrelevant peers observe and bounded chains terminate.
- Preserve every participant, role, provider-model, and agent-context coordinate across restart.
- Keep one reviewed unaddressed-owner priority for every local and cross-Node peer, and fail startup when Nodes disagree.
- Bind a formal policy seat to a named hired agent only through an accepted immutable route, then publish that seat through the agent's existing Discord deployment without creating a shadow identity.
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
- [ADR-0396](../../../../decisions/coordination/sync/0396-conflict-safe-repository-replica-continuation.md)
- [ADR-0408](../../../../decisions/coordination/conversations/0408-conversation-task-delegation-to-hired-agents.md)
- [ADR-0411](../../../../decisions/coordination/conversations/agent-organization/0411-governed-agent-memory-and-autonomous-participation.md)
- [ADR-0420](../../../../decisions/coordination/conversations/agent-organization/0420-bound-agent-conversation-and-deliberation-routes.md)
- [Cross-provider deliberation runtime](../../../../decisions/execution/providers/0029-cross-provider-deliberation-runtime.md)
- [ADR-0454](../../../../decisions/coordination/conversations/agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md): relevance fan-out, live mentions, natural staffing, and discussions replacing the ceremony.
