# ADR-0048: Authenticated Slack and Discord conversation adapters

Status: `accepted`
Decision date: 2026-08-20

## Context

Native chat did not exercise platform authentication or external identity boundaries. Slack signs Events API requests, while ordinary Discord messages arrive through an authenticated Gateway session rather than an interaction webhook. Treating both as webhooks would falsely claim Discord conversation support.

## Decision

- `@lervo/conversation-platform` owns common CAS body, descriptor and receipt, and bidirectional identity ports. External tenant, channel, thread, and participant IDs never pass through the identity port into normalized events or interaction SQLite.
- Persist outbound correlation idempotently before delivery so automation depth and restart recovery remain reconstructable.
- Descriptors advertise only implemented message receive/send and thread subsets. Do not advertise edits, deletion, reactions, streaming, typing, presence, or actions before implementation.
- `@lervo/adapter-slack` verifies the raw-body limit, constant-time HMAC-SHA256, a ±300-second timestamp, and app/team scope before mapping new messages and app mentions. Follow [Slack request verification](https://api.slack.com/docs/verifying-requests-from-slack).
- `@lervo/adapter-discord` accepts only authenticated `MESSAGE_CREATE` through a transport port that owns Identify/Ready or Resume, heartbeat, application ID, and sequence. Follow [Discord Gateway documentation](https://docs.discord.com/developers/events/gateway).
- Delivery ports own OAuth or bot-token APIs and use `outboundId` as a durable idempotency key. Slack uses plain formatting. Discord disables mentions and requires an enforced nonce or durable lookup.

Authenticate and validate app, team, guild, and DM scope before identity mapping or CAS writes. Store message source only in CAS. Exclude all external IDs, secrets and tokens, Gateway handles, and raw payloads from interaction and global events.

Use `platform_authentication_failed`, `invalid_platform_payload`, `unsupported_platform_event`, `identity_mapping_failed`, `artifact_storage_failed`, and `platform_delivery_failed` without inferring success. Discord additionally uses `platform_activity_failed` for a transient typing request that fails without changing response processing. Add no global event or state.

Discord Gateway control-frame processing is independent of ordered application dispatch. Long provider work cannot delay sequence, heartbeat acknowledgement, reconnect, or resume handling. The Discord adapter advertises `typing` only when its authenticated REST activity port is installed. It starts the activity only after participation chooses a response, refreshes within Discord's expiry, and stops refresh on every response outcome; activity has no replay record or delivery receipt.

Contract fixtures cover Slack signature, challenge, replay, and scope; Discord authenticated sequence, scope, resume duplicates, heartbeat progress during long application work, and bounded typing activity; absence of external IDs; CAS-only bodies; stable outbound keys; mention suppression; and correlation persistence.

## Consequences

Slack, Discord, and native chat share one participation, responder, writing, and outbox contract. ADR-0049 composes credentials and durable identity mapping. Adapter cores own neither tokens nor WebSocket lifecycle.
