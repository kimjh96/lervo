# ADR-0394: Webhook-backed Discord agent identities

- Status: accepted
- Decision date: 2026-09-09

## Context

ADR-0385 required one Discord application, bot token, and guild installation for every visibly distinct hired agent. That boundary correctly prevented one bot user from being presented as several bot users, but it treated a bot account as the only honest Discord presentation identity. Discord incoming webhooks can instead publish with their own webhook ID and an agent-specific name and avatar. An already installed bot with `MANAGE_WEBHOOKS` can create those webhooks through the public API.

Lervo still needs one authenticated Gateway application to receive events. Hiring, external presentation, channel membership, provider execution, repository authority, and durable context must remain separate transitions.

## Decision

A Discord conversation deployment chooses one speaker strategy:

- `bot` uses the authenticated Gateway application's bot user as the external principal.
- `webhook` binds one distinct incoming webhook per configured channel to one durable hired agent. All webhook IDs in that immutable deployment form the external speaker principal. The agent's current durable display name and optional configured HTTPS avatar are applied at delivery.

The optional `speaker` state contains `kind`. Webhook state additionally requires `webhooks[]` entries with `channelId`, `webhookId`, and owner-only `tokenFile`, plus optional `avatarUrl`. Every configured guild conversation has exactly one entry. IDs and paths remain deployment configuration; tokens remain only in the referenced files and process memory. Missing coverage, duplicate IDs or paths, direct-message scope, an unhired speaker, an unsafe avatar URL, or a shared application with conflicting credentials means `invalid_config` before ingress.

Webhook-backed deployments may share the same exact Gateway application and owner-only bot-token file. Each current deployment runtime owns its authenticated Gateway connection while sharing those application credentials. The deployments retain distinct integration, worker, participant, hired-agent, provider, storage, response ownership, webhook IDs, and owner-only webhook-token files. Reusing a webhook ID or credential file across agents fails closed. A shared application with a different bot-token file also fails closed.

Gateway payload normalization maps `webhook_id` to `webhook:<id>` and records the author as an agent only after the configured identity binding succeeds. Each runtime suppresses its own webhook messages while peer webhook messages resolve to the peer's exact participant, agent, and role hashes. Webhook tokens remain outside repository history, event payloads, request hashes, logs, and conversational prose.

A manually bound coordinating bot remains unable to start an uncorrelated automation chain unless its exact reviewed participant binding opts in. That opt-in starts at depth zero but does not weaken self-message suppression, participation limits, or effect authority.

That participant may independently opt in as an effect requester. The permission is checked against its normalized participant, role, tenant-derived conversation scope, and current deployment configuration before an agent-authored continuation or platform action leaves read-only routing. It only admits the request to the existing signed continuation or allowlisted executive adapter; automation-chain initiation alone continues to grant no mutation authority.

The Discord executive adapter implements `agent.deployment.prepare` by creating an incoming webhook only in an allowlisted channel and storing its returned token in a configured owner-only credential directory. The receipt contains the webhook ID and hashes only; it never contains credential bytes. Creation uses the existing replay-safe executive boundary. An uncertain API or storage outcome is not retried automatically.

Webhook delivery preserves durable outbound replay, disables Discord mention parsing by default, and verifies the returned webhook and channel IDs. Bot delivery remains available. The platform address keeps `threadKey` and `replyToMessageKey` separate. For Discord, authenticated channel lookup resolves an incoming thread to an allowlisted parent conversation, inbound identity and correlation use that parent plus the explicit thread key, bot delivery targets the thread channel, and webhook delivery projects the thread key only as Discord's `thread_id` query. The source inbound event correlation independently resolves the reply-message ID used by bot delivery; webhook delivery retains that reply relationship as canonical evidence without claiming unsupported native reply projection. A mismatched guild, parent, channel type, delivery response, or unconfigured parent fails closed. Native Discord member presence and native `@user` mentionability still require a separate bot application; webhook identity is not represented as a guild member. Lervo participant and role addressing remains surface-neutral and does not depend on native mentionability.

No global event is added. Existing organization deployment, channel-membership, executive-effect receipt, conversation ingress, and outbound receipt contracts retain their failure and privacy meanings. The organization external-principal hash now binds the selected bot ID or exact webhook-ID set.

## Consequences

One installed Discord application can host the CEO transport and multiple visibly named Lervo agents without manufacturing bot accounts or weakening durable agent identity. A future first-party surface can reuse the same agents, context, work, and evidence because webhook configuration remains an adapter concern.

Separate Discord applications remain an optional deployment strategy when guild-member presence, independent Discord permissions, or native agent mentions are required. Native thread intake, thread delivery, and reply correlation are implemented in the shared adapter contracts. Real multi-agent acceptance still requires provisioning webhooks, binding the resulting deployment configuration, restarting the Node, and observing a bounded human-plus-two-agent conversation.

## References

- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [Organization teams and durable hired-agent identities](0386-organization-teams-and-agent-identities.md)
- [Named agent identity and installed organization effects](0393-named-agent-identity-and-installed-organization-effects.md)
- [Conversation deployment composition](../../../architecture/system/conversation-routing/deployment-composition.md)
- [Discord Webhook Resource](https://docs.discord.com/developers/resources/webhook)
