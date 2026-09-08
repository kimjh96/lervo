# ADR-0391: Deterministic multi-agent conversation turn ownership

- Status: accepted
- Decision date: 2026-09-09

## Context

Distinct hired-agent bots can independently judge the same unaddressed message relevant. Allowing every bot to respond causes duplicate typing, provider cost, reply storms, and nondeterministic agent-to-agent loops. Recording a non-selected agent as semantically irrelevant would create false evidence. Discord-specific locks would prevent a future Lervo conversation surface from reusing the rule.

## Decision

`@lervo/conversation-contract` resolves response ownership from the normalized source-event hash, Lervo conversation ID, and durable participant/role candidates. It never consumes a Discord application ID, channel ID, credential, message body, or provider choice.

Exact participant mentions own their turns. A role mention selects one candidate per mentioned role. An unaddressed message or subscribed signal selects one candidate across the conversation. Deterministic rendezvous scoring lets independently deployed bots reach the same result despite different integration and normalized event IDs. The source actor is never a candidate for its own turn.

`@lervo/interaction` evaluates ownership before relevance, typing, or provider execution. A non-owner commits the existing participation decision with `action: observe`, `reason: turn_not_owned`, and `relevance: not_checked`. This means another eligible participant owns the response; it is not a semantic relevance result, delivery result, or execution failure. The state retains only the existing event, policy, project, conversation, role, decision, and time coordinates. Candidate rosters and scoring inputs are not persisted.

The Node composition boundary supplies the current hired-agent participant and only peers bound to the same Lervo conversation. The common contract owns selection; Discord owns external identity mapping; interaction owns durable observation. Provider adapters remain unaware of group scheduling.

## Consequences

Unaddressed human and agent messages produce at most one automatic responder per role scope, while explicit participant addressing remains natural. Non-owning bots neither flash a typing indicator nor invoke relevance and response providers. Automation depth, cooldown, hourly limits, self-message suppression, and deliberation termination remain independent bounds.

This decision does not provision a second Discord application, create a proactive signal, or grant mutation authority. These remain separate deployment, signal-source, and effect transitions.

## References

- [Platform-neutral conversation participation](0046-platform-neutral-conversation-participation.md)
- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
