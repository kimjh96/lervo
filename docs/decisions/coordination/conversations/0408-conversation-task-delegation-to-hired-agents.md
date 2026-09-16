# ADR-0408: Conversation task delegation to hired agents

- Status: accepted
- Decision date: 2026-09-16

## Context

A product owner hires specialist agents into a conversation; each accumulates its own provider session, deployment, and repository context. [ADR-0394](0394-webhook-backed-discord-agent-identities.md) gives them distinct speaking identities, and [ADR-0395](0395-resumable-native-repository-work-turns.md) requires a separately deployed child to receive work through its own deployment.

These capabilities were not connected to the requesting agent's turn. When an owner requested work belonging to a hired specialist, the product owner performed it in its own session, leaving the specialist's context unused. Reaching the specialist required the human to address it explicitly and retain routing knowledge.

[ADR-0391](0391-deterministic-multi-agent-turn-ownership.md) already selects a turn owner from exact participant and role mentions before evaluating relevance. Delegation needs that ownership ladder, which was previously unreachable from inside a turn.

## Decision

### Delegation as a conversation surface effect

A conversation deployment with peer agents also deploys the `workforce_task_delegate` surface effect. Its argument is compact JSON containing exactly `roleId` and `task`, at most 1,024 characters. The `task` states a bounded request in the conversation language. The effect is deployed only when peer agents exist, so deployments without hired agents do not offer it.

The responding agent chooses delegation like any other effect. Its instruction says to prefer delegation whenever a hired agent owns the subject instead of performing that work itself.

### Delegation re-enters the conversation as an addressed turn

Delegation dispatches one inbound `message.created` event into the same conversation and thread, authored by the delegating agent and addressed to the target participant. The existing ownership ladder selects the hired agent, whose turn runs in its own deployment, provider session, and context.

Delegation reuses the inbound conversation contract, adding no event type, stored field, or table. Task text is stored in CAS like other conversation content, under the same conversation-scoped privacy.

The delegated event inherits the source event's automation depth plus one, capped at the reviewed bound of eight. It cannot extend an agent-to-agent chain beyond what [ADR-0395](0395-resumable-native-repository-work-turns.md) admits; a chain already at the bound stays there.

Conversation effects are composed before the conversation application opens, but delegated turns must re-enter through that application. The dispatcher therefore resolves its application handle when called, not when wired.

### Failure meaning

Delegation refuses and dispatches nothing when:

- The requester is not an admitted effect requester.
- The specification is not JSON or does not contain exactly `roleId` and `task`.
- No hired agent holds the role.
- The agent holding the role does not participate in this conversation.
- The conversation application is not yet open.

Each refusal is a bounded error on the requesting turn; none synthesizes a turn for an agent that cannot answer it.

## Consequences

A product owner can route work to its hired specialist without the human naming that specialist. Work runs where its context lives instead of in the router's session.

Delegation grants no new authority. The delegated agent answers under its own participation policy, its own effect-request authority, and the same automation bound. Delegation cannot reach an action the delegating agent could not already request or extend a chain beyond its reviewed depth.

## References

- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
