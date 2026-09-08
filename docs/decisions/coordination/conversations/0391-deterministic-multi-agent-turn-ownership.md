# ADR-0391: Deterministic multi-agent conversation turn ownership

- Status: accepted
- Decision date: 2026-09-09

## Context

Distinct hired-agent bots can independently judge the same unaddressed message relevant. Letting every bot respond causes duplicate typing, provider cost, reply storms, and nondeterministic agent-to-agent loops. Treating a non-selected agent as semantically irrelevant would make false evidence. Discord-specific locks would also prevent a future Lervo conversation surface from reusing the rule.

## Decision

`@lervo/conversation-contract` resolves response ownership from the normalized source-event hash, Lervo conversation ID, and durable participant/role candidates. It never consumes a Discord application ID, channel ID, credential, message body, or provider choice.

Exact participant mentions own their turns. A role mention selects one candidate for each mentioned role. An unaddressed message or subscribed signal selects one candidate across the conversation. Selection uses deterministic rendezvous scoring, so independently deployed bots reach the same result even though their integration and normalized event IDs differ. The source actor is never a candidate for its own turn.

`@lervo/interaction` evaluates ownership before relevance, typing, or provider execution. A non-owner commits the existing participation decision with `action: observe`, `reason: turn_not_owned`, and `relevance: not_checked`. This state means another eligible participant owns the response; it is not a semantic relevance result, delivery result, or execution failure. It retains only the existing event, policy, project, conversation, role, decision, and time coordinates. Candidate rosters and scoring inputs are not persisted.

The Node composition boundary supplies the current hired-agent participant and only peers bound to the same Lervo conversation. The common contract owns selection; Discord owns external identity mapping; interaction owns durable observation; provider adapters remain unaware of group scheduling.

## Consequences

Unaddressed human and agent messages produce at most one automatic responder per role scope, while explicit participant addressing remains natural. Non-owning bots do not flash a typing indicator or invoke relevance and response providers. Automation depth, cooldown, hourly limits, self-message suppression, and deliberation termination remain independent bounds.

This decision does not provision a second Discord application, create a proactive signal, or grant mutation authority. Those remain separate deployment, signal-source, and effect transitions.

## References

- [Platform-neutral conversation participation](0046-platform-neutral-conversation-participation.md)
- [Realtime conversation effects and lifecycle](0388-realtime-conversation-effects-and-lifecycle.md)
- [Role-backed multi-party conversation](../../../roadmap/product-outcome-convergence/host-products/discord/multi-party-conversation.md)
