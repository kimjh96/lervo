# Discord configuration

Optional `discordConversation` enables one Discord-first remote-continuation identity in the same Node service. The mutually exclusive `discordConversations` array enables one to eight distinct bot identities. Keep the Hub token, each bot token, and configuration in separate mode-0600 regular files.

Each object binds an integration and worker, bot application and allowed guild or DM scope, explicit channel and participant mappings, one agent participant, and a bounded managed-command policy. Optional `routing` adds no-capability natural-language intent resolution with a distinct read-only execution role. Decisions linked from the [distribution entrypoint](../node-runtime-distribution.md) define fields and failure behavior.

- [Example configuration](discord-configuration/example.md)
- [Behavior, participants, and execution settings](discord-configuration/execution.md)

## Multiple bot identities

For multiple visible role agents, supply complete objects of the same shape in `discordConversations`. Each requires a distinct application ID, token file, integration ID, worker ID, agent participant ID, and hired `agentId`.

Shared external channels must use the same `conversationId`. Peer bot author and mention identities bind automatically; do not also list those application IDs in `participants`. Preflight validates every token. Runtime conversation health reaches `ready` only after every configured bot is ready.
