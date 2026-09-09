# Discord configuration

Optional `discordConversation` enables one Discord-first remote-continuation identity in the same Node service. The mutually exclusive `discordConversations` array enables one to eight distinct bot- or webhook-backed agent identities. Keep the Hub token, bot tokens, webhook tokens, and configuration in owner-only regular files.

Each object binds an integration and worker, bot application and allowed guild or DM scope, explicit channel and participant mappings, one agent participant, and a bounded managed-command policy. Optional `routing` adds no-capability natural-language intent resolution with a distinct read-only execution role. Decisions linked from the [distribution entrypoint](../node-runtime-distribution.md) define fields and failure behavior.

- [Example configuration](discord-configuration/example.md)
- [Behavior, participants, and execution settings](discord-configuration/execution.md)

## Multiple agent identities

For multiple visible role agents, supply complete objects of the same shape in `discordConversations`. Bot speakers require distinct application IDs. Webhook speakers set `speaker.kind` to `webhook`, bind one distinct webhook and owner-only token file to every configured conversation channel, and may share one exact application ID and bot-token file. Every deployment still requires a distinct integration ID, worker ID, agent participant ID, and hired `agentId`.

Shared external channels must use the same `conversationId`. Peer bot and webhook authors bind automatically; bot mention aliases bind automatically, while webhooks use Lervo participant or role addressing because they are not guild members. Do not repeat speaker IDs in `participants`. Preflight validates every token. Runtime conversation health reaches `ready` only after every configured Gateway connection is ready.

Automatic peer discovery applies only to deployments in the same Node configuration. A deployment in a separate repository Node declares each observed peer in `peerAgents`, including its surface participant keys, durable participant and agent IDs, exact role version and hashes, tenant scope, and shared conversation IDs. Startup rejects stale, duplicate, self-referential, or out-of-scope peer bindings. This explicit binding lets history reconciliation and live ingress attribute peer webhook messages without making Discord identity canonical.

Allowlisted executive `agent.deployment.prepare` uses `incoming_webhook.create`. Configure `administration.webhookCredentialDirectory` as an owner-only directory. A successful effect writes `<effectId>.token` there and returns only the webhook ID and hashed receipt; add that ID and file path to the reviewed runtime configuration before binding the organization deployment.
