# ADR-0394: Webhook-backed Discord agent identities

- Status: accepted
- Decision date: 2026-09-09

## Context

ADR-0385 required a separate Discord application, bot token, and guild installation for each visibly distinct hired agent. This prevented presenting one bot user as several but treated bot accounts as the only honest presentation identity. Incoming webhooks have distinct IDs and can publish with agent-specific names and avatars. An installed bot with `MANAGE_WEBHOOKS` can create them through the public API.

Lervo still requires an authenticated Gateway application for events. Hiring, external presentation, channel membership, provider execution, repository authority, and durable context remain separate transitions.

## Decision

### Speaker configuration

Each Discord conversation deployment selects one strategy:

- `bot`: the authenticated Gateway application's bot user is the external principal.
- `webhook`: one distinct incoming webhook per configured channel binds to one durable hired agent. The immutable deployment's complete webhook-ID set forms its external speaker principal. Delivery uses the agent's current durable display name and optional configured HTTPS avatar.

Optional `speaker` state contains `kind`. Webhook state also requires `webhooks[]` entries with `channelId`, `webhookId`, and owner-only `tokenFile`, plus optional `avatarUrl`. Every configured guild conversation has exactly one entry. IDs and paths are deployment configuration; tokens exist only in referenced files and process memory. Missing coverage, duplicate IDs or paths, direct-message scope, an unhired speaker, unsafe avatar URLs, or conflicting credentials for a shared application cause `invalid_config` before ingress.

Webhook deployments may share the exact Gateway application and owner-only bot-token file. Each current runtime owns its authenticated Gateway connection. Deployments retain distinct integration, worker, participant, hired-agent, provider, storage, response ownership, webhook IDs, and owner-only webhook-token files. Reusing webhook IDs or credential files across agents fails closed, as does sharing an application with a different bot-token file.

### Ingress and peer identity

Gateway normalization maps `webhook_id` to `webhook:<id>` and records an agent author only after configured identity binding succeeds. Each runtime suppresses its own webhook messages; peer webhook messages resolve to the peer's exact participant, agent, and role hashes. Webhook tokens remain outside repository history, event payloads, request hashes, logs, and conversational prose.

Deployments composed by one Node derive peer bindings from sibling configuration. A separate repository Node declares bounded `peerAgents` entries containing only external participant keys, durable participant and agent identifiers, exact role version and hashes, and tenant and conversation scope. Startup rejects duplicate principals, self-bindings, malformed hashes, and coordinates outside the local allowlist. Unbound webhook authors fail closed. History reconciliation never invents or downgrades agent identity merely to advance a cursor.

### Automation and effect authority

An exact reviewed peer-agent binding may start an uncorrelated automation chain at depth zero while retaining self-message suppression, participation limits, and effect authority. Agent-to-agent responses always project as replies. Each receiving integration derives the next automation depth from the correlated source message, preserving the same bounded chain across separate bot processes and stopping at the configured maximum. Human-facing sequential responses remain standalone by default.

That participant may separately opt in as an effect requester. Before agent-authored continuation or platform action leaves read-only routing, permission is checked against the normalized participant, role, tenant-derived conversation scope, and current deployment configuration. Permission only admits the request to the existing signed continuation or allowlisted executive adapter. Chain initiation alone grants no mutation authority.

The Discord executive adapter implements `agent.deployment.prepare` by creating an incoming webhook only in an allowlisted channel and storing its returned token in a configured owner-only credential directory. The receipt contains only the webhook ID and hashes, never credential bytes. Creation uses the existing replay-safe executive boundary; uncertain API or storage outcomes are not automatically retried.

An installed product-owner deployment allowing both `workforce.agent.hire` and `incoming_webhook.create` automatically composes those separate transitions. After a successful workforce hire, the Node reserves an owner-only preparation record, creates one webhook for the current project conversation, stores its token in a deterministic owner-only file, records verified non-secret deployment coordinates, and atomically converts or extends runtime configuration with a child deployment. An existing exact child deployment is idempotent. A pending record without verified coordinates means the platform result is uncertain and blocks automatic retry.

Before replacing runtime configuration, clearing that preparation record, or requesting a restart, the same organization mutation boundary binds the child's active team membership, immutable external deployment, and conversation channel membership as canonical events. Existing deployments pass through the same idempotent binding during reconciliation. A missing or conflicting repository team therefore leaves the prior runtime configuration active and fails the hire preparation before the success response can claim an activatable child.

The child deployment binds the durable child agent, its role hashes, a distinct participant and integration, the current team conversation, its own interaction and provider-session stores, and the parent's configured provider limits. It inherits no product-owner administration actions. The hire response is delivered and durably acknowledged before the conversation supervisor requests a controlled process restart; the service supervisor then activates the new immutable deployment. The parent never speaks as the child merely because the workforce record exists.

Independently, a managed natural turn may select allowlisted text-channel or public-thread creation. Public threads are limited to the current mapped channel. Both operations verify returned Discord scope before reporting success.

### Delivery, threads, and replies

Webhook delivery preserves durable outbound replay, disables Discord mention parsing by default, and verifies returned webhook and channel IDs. Bot delivery remains available.

Platform addresses keep `threadKey` separate from `replyToMessageKey`. For Discord:

- Authenticated channel lookup resolves an incoming thread to an allowlisted parent conversation.
- Inbound identity and correlation use that parent and the explicit thread key.
- Bot delivery targets the thread channel.
- Webhook delivery projects the thread key only as Discord's `thread_id` query.
- Source inbound event correlation independently resolves the available reply-message ID.

A managed response records surface-neutral `deliveryRelation` as `standalone` or `reply`. Ordinary sequential turns default to `standalone`. A managed turn may select `reply` only when the native relationship materially disambiguates the target or preserves an explicit reply. A Discord reply to a configured bot or webhook also projects the referenced speaker as an addressed participant, so every observing runtime selects the same interlocutor. Bot delivery projects this selection; webhook delivery retains canonical evidence without claiming unsupported native reply projection. Legacy outbound records without the additive field are standalone. The value contains no message content or platform identifier. Invalid values fail outbound validation before delivery.

A mismatched guild, parent, channel type, delivery response, or unconfigured parent fails closed. Native Discord member presence, typing indicators, and `@user` mentionability require a separate installed bot application per agent. Webhook identities are not guild members and cannot emit typing. For them, an exact leading `@DisplayName` is normalized to the configured participant key before identity and turn-ownership resolution. This is Lervo addressing rather than a native Discord mention; ambiguous aliases and unbound principals fail configuration or identity mapping instead of falling back to an unrelated responder.

### Existing contracts

No global event is added. Organization deployment, channel-membership, executive-effect receipt, conversation ingress, and outbound receipt contracts retain their failure and privacy meanings. The organization external-principal hash binds the selected bot ID or exact webhook-ID set.

## Consequences

One installed Discord application can host CEO transport and multiple visibly named Lervo agents without manufacturing bot accounts or weakening durable agent identity. A future first-party surface can reuse their agents, context, work, and evidence because webhook configuration remains an adapter concern.

Each agent needing native guild-member presence, independent typing, independent Discord permissions, or native agent mentions requires a separate installed Discord application. Separate applications remain optional only for webhook identities without those requirements.

Native thread intake, thread delivery, reply addressing, automated webhook provisioning, atomic deployment binding, and post-delivery restart are installed. Real multi-agent acceptance still requires observing a bounded human-plus-two-agent conversation after the updated runtime is deployed.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Named agent identity and installed organization effects](0393-named-agent-identity-and-installed-organization-effects.md)
- [Conversation deployment composition](../../../architecture/system/conversation-routing/deployment-composition.md)
- [Discord Webhook Resource](https://docs.discord.com/developers/resources/webhook)
