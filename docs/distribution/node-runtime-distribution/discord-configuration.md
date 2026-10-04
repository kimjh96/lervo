# Discord configuration

Optional `discordConversation` enables one Discord-first remote-continuation identity in the same Node service. The mutually exclusive `discordConversations` array enables one to eight distinct bot- or webhook-backed agent identities. Keep the Hub token, bot tokens, webhook tokens, and configuration in owner-only regular files.

Each object binds an integration and worker, bot application and allowed guild or DM scope, explicit channel and participant mappings, one agent participant, and a bounded managed-command policy. Optional `routing` adds no-capability natural-language intent resolution with a distinct read-only execution role. Decisions linked from the [distribution entrypoint](../node-runtime-distribution.md) define fields and failure behavior.

- [Example configuration](discord-configuration/example.md)
- [Behavior, participants, and execution settings](discord-configuration/execution.md)
- [Multiple agent identities](discord-configuration/multiple-agent-identities.md)
- [Request-scoped runtimes](discord-configuration/request-scoped-runtimes.md)
