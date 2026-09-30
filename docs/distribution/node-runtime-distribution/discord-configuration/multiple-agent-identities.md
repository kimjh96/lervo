# Multiple agent identities

Supply complete objects of the same shape in `discordConversations` for multiple visible role agents. Bot speakers require distinct application IDs. Webhook speakers set `speaker.kind` to `webhook` and bind one distinct webhook and owner-only token file to each configured conversation channel; they may share one exact application ID and bot-token file. Every deployment requires a distinct integration ID, worker ID, agent participant ID, and hired `agentId`.

Shared external channels must use the same `conversationId`. Peer bot and webhook authors bind automatically, as do bot mention aliases. Webhooks use Lervo participant or role addressing because they are not guild members. Do not repeat speaker IDs in `participants`. Preflight validates every token. Runtime conversation health reaches `ready` only after every configured Gateway connection is ready.

Automatic peer discovery applies only to deployments in the same Node configuration. A deployment in a separate repository Node declares each observed peer in `peerAgents`, including:

- Surface participant keys, durable participant and agent IDs.
- Display address when the peer is a webhook.
- Exact role version and hashes.
- Reviewed unaddressed priority, tenant scope, and shared conversation IDs.

Every Node observing the peer must use the same priority; conflicting local and peer views fail startup. This explicit binding lets history reconciliation and live ingress attribute peer webhook messages and route PO-to-worker, worker-to-PO, and worker-to-worker turns without making Discord identity canonical.

Allowlisted executive `agent.deployment.prepare` uses `incoming_webhook.create`. Configure `administration.webhookCredentialDirectory` as an owner-only directory. A successful effect writes `<effectId>.token` there and returns only the webhook ID and hashed receipt. Add that ID and file path to the reviewed runtime configuration before binding the organization deployment.
