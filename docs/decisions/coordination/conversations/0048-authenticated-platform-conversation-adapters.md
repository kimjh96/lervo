# ADR-0048: Authenticated Slack and Discord conversation adapters

Status: `accepted`
Decision date: 2026-08-20

## Context

Native chat alone did not test real platform authentication or external identity boundaries. Slack signs each Events API request, while ordinary Discord chat arrives through an authenticated Gateway session, not an interaction webhook. Treating both as webhooks would falsely claim Discord conversation support.

## Decision

- `@lervo/conversation-platform` owns common CAS body, descriptor/receipt, and bidirectional identity ports. External tenant/channel/thread/participant IDs never cross the identity port into normalized events or interaction SQLite.
- Persist outbound correlation idempotently before delivery so automation depth and restart recovery remain reconstructable.
- Descriptors declare only implemented subsets of message receive/send and threads. Do not advertise edits, deletion, reactions, streaming, typing, presence, or actions before implementation.
- `@lervo/adapter-slack` verifies raw-body limit, HMAC-SHA256 in constant time, ±300-second timestamp, and app/team scope before mapping new messages/app mentions. Follow [Slack request verification](https://api.slack.com/docs/verifying-requests-from-slack).
- `@lervo/adapter-discord` consumes only authenticated `MESSAGE_CREATE` through a transport port that owns Identify/Ready or Resume, heartbeat, application ID, and sequence. Follow [Discord Gateway documentation](https://docs.discord.com/developers/events/gateway).
- Delivery ports own OAuth/bot-token APIs and use `outboundId` as a durable idempotency key. Slack uses plain formatting; Discord disables mentions and requires enforced nonce or durable lookup.

Authenticate and validate app/team/guild/DM scope before identity mapping or CAS writes. Store message source only in CAS. Exclude all external IDs, secrets/tokens, Gateway handles, and raw payloads from interaction/global events.

Use `platform_authentication_failed`, `invalid_platform_payload`, `unsupported_platform_event`, `identity_mapping_failed`, `artifact_storage_failed`, and `platform_delivery_failed` without inferring success. Add no global event/state.

Contract fixtures cover Slack signature/challenge/replay/scope, Discord authenticated sequence/scope/resume duplicate, absence of external IDs, CAS-only bodies, stable outbound keys, mention suppression, and correlation persistence.

## Consequences

Slack, Discord, and native chat converge on one participation/responder/writing/outbox contract. ADR-0049 composes credentials and durable identity mapping; adapter cores own neither tokens nor WebSocket lifecycle.
