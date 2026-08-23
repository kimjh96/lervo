# ADR-0046: Platform-neutral conversation participation

Status: `accepted`
Decision date: 2026-08-20

## Context

Slack and Discord are transports, not Lervo's conversation model. Core must not absorb platform payloads, webhook mechanics, or IDs. Mention-only agents cannot participate naturally, while replying to everything creates disruption, loops, and unbounded cost. Observation also does not prove a role loaded or received context.

## Decision

- `@lervo/conversation-contract` defines common targets, inbound events, descriptors, participation policy/decision, outbound messages, and receipts. Capabilities explicitly cover receive/send, threads, edit/delete, reactions, streaming, typing, presence, and actions; infer nothing unsupported.
- Hash external message IDs immediately and store bodies only as CAS coordinates. Map external users to Lervo participants before normalized/interaction state.
- Native chat, Slack, Discord, and future platforms implement adapters; each transport authenticates before its adapter.
- Policy modes are `mention_only`, `relevant`, `proactive`, and `silent`, with allowed actors, subscribed signals, cooldown/rate limits, and automation depth. Apply actor/rate/depth limits first. Mentions qualify directly; ordinary relevant/proactive messages require a separate relevance evaluator. Missing/failed/uncertain evaluation yields `observe/relevance_unavailable`. Proactive signals must be explicitly subscribed.
- Observation/response creates no `loaded`, `injected`, or `used`; a responder must run a managed role session with its own context evidence.
- `@lervo/interaction` creates outbound only when a `chat` writing permit exactly binds the reply artifact under the configured publication language (`en` in v1).
- SQLite keeps a per-message/per-role inbox so roles decide independently. Atomically claim, decide, and create outbound. Inbox states are pending/leased/completed; outbox pending/leased/delivered. Terminal states are immutable, expired leases recoverable, and failures retain only short code/retry time.
- Store only internal coordinates, artifact hashes, mapped participants/roles, mention/depth, and times. Exclude message bodies, external IDs, prompts, payloads, and errors. Delivery receipts retain only hashed delivery keys.

Adapter/generation/publication failures retry with fixed codes; relevance failure is conservative observation, not execution failure. Storage failure claims no completion/delivery. Add no global execution event; interaction state implies neither managed completion, event sync, publication, nor E3.

Fixtures cover policy modes/limits, multi-role independence, permit enforcement, restart idempotency, delivery retry, immutable terminal state, audit, and absence of raw identifiers/source.

## Consequences

Conversation participation and durable delivery are independent of platform/model. ADR-0047 adds managed responders; ADR-0048/0049 add authenticated platforms and deployment.
