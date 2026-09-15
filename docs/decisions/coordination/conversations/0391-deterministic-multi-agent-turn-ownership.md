# ADR-0391: Deterministic multi-agent conversation turn ownership

- Status: accepted
- Decision date: 2026-09-09

## Context

Distinct hired-agent bots can independently judge the same unaddressed message relevant. Letting every bot respond causes duplicate typing, provider cost, reply storms, and nondeterministic agent-to-agent loops. Recording a non-selected agent as semantically irrelevant would create false evidence. Discord-specific locks would prevent reuse on a future Lervo conversation surface.

## Decision

`@lervo/conversation-contract` resolves response ownership from the Lervo conversation ID and durable participant/role candidates. Role-addressed ties may also use the normalized source-event hash. It never consumes a Discord application ID, channel ID, credential, message body, or provider choice.

Ownership follows these rules:

- Exact participant mentions own their turns.
- A role mention selects one candidate per mentioned role.
- An unaddressed message or subscribed signal selects one stable candidate across the conversation, filtered first by the highest reviewed unaddressed priority. Node composition gives a CEO priority over ordinary project participants, so general conversation does not rotate between POs on every message.
- Deterministic rendezvous scoring lets independently deployed bots reach the same result despite different integration and normalized event IDs.
- The source actor is never a candidate for its own turn. An unaddressed agent-authored turn uses the same non-source deterministic owner and then semantic relevance, rather than being suppressed solely because no mention was present. Automation depth, rate limits, cooldown, and effect authorization still bound the exchange.

A unique explicit participant or role address also becomes the deployment's bounded in-memory owner for that conversation and thread. Subsequent unaddressed human turns stay with that interlocutor instead of reverting to the general-channel winner. That hold is bounded by idle conversation time rather than held until restart: each retained turn renews it, and a gap longer than the reviewed idle interval releases the conversation back to the general unaddressed rule. The bound reads the normalized event time, not a process clock, so peers reading the same events release it identically. Every peer observes the same explicit address and reaches the same sticky choice. Discord normalizes a reply to a configured bot or webhook as an explicit participant address. Restart discards this transient state and safely restores deterministic stable ownership; durable agent and provider context remain unchanged.

`@lervo/interaction` evaluates ownership before relevance, typing, or provider execution. A non-owner commits the existing participation decision with `action: observe`, `reason: turn_not_owned`, and `relevance: not_checked`. This means another eligible participant owns the response; it is not a semantic relevance result, delivery result, or execution failure. State retains only the existing event, policy, project, conversation, role, decision, and time coordinates. Candidate rosters and scoring inputs are not persisted.

The Node composition boundary supplies the current hired-agent participant and only peers bound to the same Lervo conversation. The common contract owns selection; Discord owns external identity mapping; interaction owns durable observation. Provider adapters remain unaware of group scheduling.

Discord deployments ignore a turn containing external mentions when none of those principals resolve locally. They do not erase unresolved addressing and reinterpret the message as unaddressed. A configured peer also discovered as a same-process peer is included once when its durable agent, role, tenant, and speaker coordinates agree. Disagreement fails configuration before duplicate candidates reach turn selection.

## Consequences

Unaddressed human and agent messages produce at most one automatic responder per role scope, while explicit participant addressing remains natural. Natural-language deployments evaluate unaddressed human turns by default, so ownership is eligibility rather than a forced response. Non-owning bots neither flash a typing indicator nor invoke relevance and response providers. Automation depth, cooldown, hourly limits, self-message suppression, and deliberation termination remain independent bounds.

This decision does not provision a second Discord application, create a proactive signal, or grant mutation authority. These remain separate deployment, signal-source, and effect transitions.

## References

- [Platform-neutral conversation participation](0046-platform-neutral-conversation-participation.md)
- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
