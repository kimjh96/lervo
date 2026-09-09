# ADR-0046: Platform-neutral conversation participation

Status: `accepted`
Decision date: 2026-08-20

## Context

Slack and Discord are transports, not Lervo's conversation model. Core must exclude platform payloads, webhook mechanics, and IDs. Mention-only agents cannot participate naturally; replying to everything causes disruption, loops, and unbounded cost. Observation does not prove that a role loaded or received context.

## Decision

- `@lervo/conversation-contract` defines common targets, inbound events, descriptors, participation policy and decisions, outbound messages, and receipts. Capabilities explicitly cover receive/send, threads, edit/delete, reactions, streaming, typing, presence, and actions. Never infer unsupported capabilities.
- Hash external message IDs immediately; store bodies only as CAS coordinates. Map external users to Lervo participants before normalized or interaction state.
- Native chat, Slack, Discord, and future platforms use adapters. Every transport authenticates before its adapter.
- Policy modes are `mention_only`, `relevant`, `proactive`, and `silent`, with allowed actors, subscribed signals, cooldown and rate limits, and automation depth. Apply actor, rate, and depth limits first. An uncorrelated agent message defaults to maximum depth. Only an exact reviewed participant binding may start a new automation chain at depth zero, without gaining effect authority. Mentions qualify directly. Ordinary relevant or proactive messages require a separate relevance evaluator; missing, failed, or uncertain evaluation produces `observe/relevance_unavailable`. Proactive signals require explicit subscription.
- Observation or response creates no `loaded`, `injected`, or `used` evidence. A responder runs a managed role session with separate context evidence.
- `@lervo/interaction` creates outbound messages only when a `chat` writing permit exactly binds the reply artifact under the configured publication language (`en` in v1).
- SQLite maintains a per-message, per-role inbox so roles decide independently. Claim, decide, and create outbound atomically. Inbox states are pending/leased/completed; outbox states are pending/leased/delivered. Terminal states are immutable, expired leases recoverable, and failures retain only a short code and retry time.
- Store only internal coordinates, artifact hashes, mapped participants and roles, mention/depth, and times. Exclude message bodies, external IDs, prompts, payloads, and errors. Delivery receipts contain only hashed delivery keys.

Adapter, generation, and publication failures retry with fixed codes. Relevance failure conservatively observes and is not an execution failure. Storage failure claims neither completion nor delivery. Add no global execution event. Interaction state implies neither managed completion, event sync, publication, nor E3.

Fixtures cover policy modes and limits, multi-role independence, permit enforcement, restart idempotency, delivery retry, immutable terminal state, audit, and absence of raw identifiers and source.

## Consequences

Conversation participation and durable delivery remain independent of platform and model. ADR-0047 adds managed responders; ADR-0048 and ADR-0049 add authenticated platforms and deployment.
