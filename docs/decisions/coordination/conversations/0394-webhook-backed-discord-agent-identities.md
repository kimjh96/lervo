# ADR-0394: Webhook-backed Discord agent identities

- Status: accepted
- Decision date: 2026-09-09

## Context

ADR-0385 required a separate Discord application, bot token, and guild installation for each visibly distinct hired agent. This prevented presenting one bot user as several but treated bot accounts as the only honest presentation identity. Incoming webhooks have their own IDs and can publish with agent-specific names and avatars. An installed bot with `MANAGE_WEBHOOKS` can create them through the public API.

Lervo still needs an authenticated Gateway application for events. Hiring, external presentation, channel membership, provider execution, repository authority, and durable context remain separate transitions.

## Decision

### Speaker configuration

Each Discord conversation deployment selects one strategy:

- `bot`: the authenticated Gateway application's bot user is the external principal.
- `webhook`: one distinct incoming webhook per configured channel binds to one durable hired agent. The immutable deployment's complete webhook-ID set forms its external speaker principal. Delivery uses the agent's current durable display name and optional configured HTTPS avatar.

Optional `speaker` state contains `kind`. Webhook state also requires `webhooks[]` entries containing `channelId`, `webhookId`, and owner-only `tokenFile`, plus optional `avatarUrl`. Every configured guild conversation has exactly one entry. IDs and paths are deployment configuration; tokens exist only in referenced files and process memory. Missing coverage, duplicate IDs or paths, direct-message scope, an unhired speaker, an unsafe avatar URL, or conflicting credentials for a shared application causes `invalid_config` before ingress.

Webhook deployments may share the exact Gateway application and owner-only bot-token file. Each current runtime owns its authenticated Gateway connection. Deployments retain distinct integration, worker, participant, hired-agent, provider, storage, response ownership, webhook IDs, and owner-only webhook-token files. Reusing webhook IDs or credential files across agents fails closed, as does sharing an application with a different bot-token file.

### Ingress and peer identity

Gateway normalization maps `webhook_id` to `webhook:<id>` and records an agent author only after configured identity binding succeeds. Each runtime suppresses its own webhook messages; peer webhook messages resolve to the peer's exact participant, agent, and role hashes. Webhook tokens remain outside repository history, event payloads, request hashes, logs, and conversational prose.

Deployments composed by one Node derive peer bindings from sibling configuration. A separate repository Node declares bounded `peerAgents` entries containing only external participant keys, durable participant and agent identifiers, exact role version and hashes, and tenant and conversation scope. Startup rejects duplicate principals, self-bindings, malformed hashes, and coordinates outside the local allowlist. Unbound webhook authors fail closed. History reconciliation never invents or downgrades agent identity merely to advance a cursor.

### Automation and effect authority

A manually bound coordinating bot may start an uncorrelated automation chain only through an opt-in on its exact reviewed participant binding. It starts at depth zero while retaining self-message suppression, participation limits, and effect authority.

That participant may separately opt in as an effect requester. Before agent-authored continuation or a platform action leaves read-only routing, permission is checked against the normalized participant, role, tenant-derived conversation scope, and current deployment configuration. Permission only admits the request to the existing signed continuation or allowlisted executive adapter. Chain initiation alone grants no mutation authority.

The Discord executive adapter implements `agent.deployment.prepare` by creating an incoming webhook only in an allowlisted channel and storing its returned token in a configured owner-only credential directory. The receipt contains only the webhook ID and hashes, never credential bytes. Creation uses the existing replay-safe executive boundary; uncertain API or storage outcomes are not retried automatically.

Independently, a managed natural turn may select allowlisted text-channel or public-thread creation. Public threads are limited to the current mapped channel. Both operations verify returned Discord scope before reporting success.

### Delivery, threads, and replies

Webhook delivery preserves durable outbound replay, disables Discord mention parsing by default, and verifies returned webhook and channel IDs. Bot delivery remains available.

Platform addresses keep `threadKey` separate from `replyToMessageKey`. For Discord:

- Authenticated channel lookup resolves an incoming thread to an allowlisted parent conversation.
- Inbound identity and correlation use that parent and the explicit thread key.
- Bot delivery targets the thread channel.
- Webhook delivery projects the thread key only as Discord's `thread_id` query.
- Source inbound event correlation independently resolves the available reply-message ID.

A managed response records surface-neutral `deliveryRelation` as `standalone` or `reply`. Ordinary sequential turns default to `standalone`. A managed turn may select `reply` only when the native relationship materially disambiguates the target or preserves an explicit reply. Bot delivery projects this selection; webhook delivery retains canonical evidence without claiming unsupported native reply projection. Legacy outbound records without the additive field are standalone. The value contains no message content or platform identifier. Invalid values fail outbound validation before delivery.

A mismatched guild, parent, channel type, delivery response, or unconfigured parent fails closed. Native Discord member presence, typing indicators, and `@user` mentionability require a separate installed bot application per agent. Webhook identities are not guild members and cannot emit typing. Lervo participant and role addressing remains surface-neutral and independent of native mentionability.

### Existing contracts

No global event is added. Organization deployment, channel-membership, executive-effect receipt, conversation ingress, and outbound receipt contracts retain their failure and privacy meanings. The organization external-principal hash binds the selected bot ID or exact webhook-ID set.

## Consequences

One installed Discord application can host CEO transport and multiple visibly named Lervo agents without manufacturing bot accounts or weakening durable agent identity. A future first-party surface can reuse their agents, context, work, and evidence because webhook configuration remains an adapter concern.

Each agent needing native guild-member presence, independent typing, independent Discord permissions, or native agent mentions requires a separate installed Discord application. Separate applications remain optional only for webhook identities without those requirements.

Native thread intake, thread delivery, and reply correlation are implemented in shared adapter contracts. Real multi-agent acceptance still requires provisioning webhooks, binding deployment configuration, restarting the Node, and observing a bounded human-plus-two-agent conversation.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Named agent identity and installed organization effects](0393-named-agent-identity-and-installed-organization-effects.md)
- [Conversation deployment composition](../../../architecture/system/conversation-routing/deployment-composition.md)
- [Discord Webhook Resource](https://docs.discord.com/developers/resources/webhook)
