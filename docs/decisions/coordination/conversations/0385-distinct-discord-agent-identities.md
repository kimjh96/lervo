# ADR-0385: Distinct Discord identities for hired agents

- Status: accepted
- Decision date: 2026-09-08

## Context

Binding a Lervo workforce agent to the one installed Discord bot preserved internal role and provider evidence, but it did not create another Discord guild member. A visible channel participant is a Discord bot user backed by its own application and token. Reusing one token while changing a Lervo participant ID would misrepresent one external principal as several agents.

## Decision

The strict Node configuration accepts either the compatible single `discordConversation` object or a bounded `discordConversations` array of one to eight complete deployments. They are mutually exclusive. Every array member retains its own application ID, owner-only token file, integration, worker, hired-agent ID, Lervo participant ID, response routing, command routing, policy, storage, Gateway session, and Discord delivery adapter.

Multi-bot configuration requires an active hired agent for every deployment and rejects duplicate application, token-file, integration, worker, participant, or agent identity. Two deployments that observe the same external channel must bind the same Lervo conversation ID. Configured application IDs cannot also appear as manually authored participant bindings.

The Node owns one supervisor over otherwise independent single-bot runtimes. Readiness becomes `ready` only after every configured Gateway is ready. Any authentication or dispatch failure makes the shared conversation component unavailable and terminates the Node through the existing `conversation_runtime_failed` path. Preflight reads every token without opening a network connection. Shutdown stops ingress and closes every runtime even if one close fails.

For shared guilds, composition automatically binds each peer application's incoming `bot:<id>` author key and `user:<id>` mention key to the peer's exact hired-agent participant and current role. The two aliases represent one principal; they do not create two agents. Agent-authored turns remain disabled unless `agent` is explicitly included in `policy.respondTo`, and existing automation-depth and hourly response limits remain the loop boundary. A peer message cannot enter write-capable continuation because that authority remains human-only.

Provider and model choices stay per deployment. Startup enforces each hired agent's fixed-or-any provider policy against its response provider. Managed-run and intent evidence continue to record the selected provider and configured model at their existing boundaries. Discord transport and core conversation contracts do not depend on Codex or Claude.

Discord application creation, token issuance, and guild installation remain Discord owner actions. Lervo never synthesizes a visible participant without a distinct external credential and never stores a bot token in tracked repository state.

## Consequences

One always-on repository Node can host multiple visible role agents without conflating external identity, workforce authority, provider selection, or failure ownership. Existing single-bot configuration continues to work. Product acceptance still requires a real guild with one person and two installed bot applications to complete a bounded discussion.

## References

- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
