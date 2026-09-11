# ADR-0385: Distinct Discord identities for hired agents

- Status: superseded by [ADR-0394](0394-webhook-backed-discord-agent-identities.md)
- Decision date: 2026-09-08

## Context

Binding a Lervo workforce agent to the installed Discord bot preserved internal role and provider evidence but created no additional guild member. Each visible participant is a Discord bot user with its own application and token. Reusing a token with different Lervo participant IDs would misrepresent one external principal as several agents.

## Decision

The strict Node configuration accepts either the compatible single `discordConversation` object or a `discordConversations` array of one to eight complete deployments, never both. Each array member retains its own application ID, owner-only token file, integration, worker, hired-agent ID, Lervo participant ID, response routing, command routing, policy, storage, Gateway session, and Discord delivery adapter.

Multi-bot configuration requires an active hired agent per deployment and rejects duplicate application, token-file, integration, worker, participant, or agent identities. Deployments observing the same external channel must bind the same Lervo conversation ID. Configured application IDs cannot also appear in manually authored participant bindings.

The Node owns one supervisor over independent single-bot runtimes:

- Readiness becomes `ready` only after every configured Gateway is ready.
- Authentication rejection or invalid runtime configuration makes the shared conversation component unavailable and terminates the Node through `conversation_runtime_failed`.
- A message-scoped dispatch failure remains isolated to that integration's interaction retry lifecycle.
- Preflight reads every token without opening a network connection.
- Shutdown stops ingress and closes every runtime even if one close fails.

For shared guilds, composition automatically binds each peer application's incoming `bot:<id>` author key and `user:<id>` mention key to the peer's exact hired-agent participant and current role. Both aliases represent one principal, not two agents. Agent-authored turns remain disabled unless `agent` is explicitly included in `policy.respondTo`; existing automation-depth and hourly response limits remain the loop boundary. Peer messages cannot enter write-capable continuation, whose authority remains human-only.

Provider and model choices remain per deployment. Startup enforces each hired agent's fixed-or-any provider policy against its response provider. Managed-run and intent evidence continue recording the selected provider and configured model at their existing boundaries. Discord transport and core conversation contracts do not depend on Codex or Claude.

Discord application creation, token issuance, and guild installation remain Discord owner actions. Lervo never synthesizes a visible participant without a distinct external credential or stores a bot token in tracked repository state.

## Consequences

One always-on repository Node can host multiple visible role agents without conflating external identity, workforce authority, provider selection, or failure ownership. Existing single-bot configuration continues to work. Product acceptance still requires a real guild with one person and two installed bot applications to complete a bounded discussion.

## References

- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
