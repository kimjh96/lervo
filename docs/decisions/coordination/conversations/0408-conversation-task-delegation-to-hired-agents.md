# ADR-0408: Conversation task delegation to hired agents

- Status: accepted
- Decision date: 2026-09-16

## Context

A product owner hires specialist agents into a conversation, and each hired agent accumulates its own provider session, deployment, and repository context. [ADR-0394](0394-webhook-backed-discord-agent-identities.md) gives those agents distinct speaking identities, and [ADR-0395](0395-resumable-native-repository-work-turns.md) states that a separately deployed child receives work through its own deployment.

Nothing connected those two facts to the requesting agent's own turn. When an owner asked a product owner for work that a hired specialist was hired to do, the product owner performed it itself in its own session. The specialist's accumulated context went unused, and the only way to reach it was for the human to address it explicitly, which pushes routing knowledge back onto the person who hired the agents precisely so they would not have to hold it.

[ADR-0391](0391-deterministic-multi-agent-turn-ownership.md) already selects a turn owner from exact participant and role mentions before evaluating relevance. That ladder is the mechanism a delegated task needs; it was simply never reachable from inside a turn.

## Decision

### Delegation as a conversation surface effect

A conversation deployment that configures peer agents also deploys the `workforce_task_delegate` surface effect. Its argument is compact JSON with exactly `roleId` and `task`, at most 1,024 characters, where `task` states the bounded request in the conversation language. The effect is deployed only when peer agents exist, so a deployment without hired agents never offers an action it cannot perform.

The responding agent chooses delegation the same way it chooses any other effect. The instruction states that an agent should prefer delegation whenever a hired agent owns the subject, rather than performing that work itself.

### Delegation re-enters the conversation as an addressed turn

Delegation dispatches one inbound `message.created` event into the same conversation and thread, authored by the delegating agent and addressed to the target participant. The existing ownership ladder then selects the hired agent, so the delegated turn runs in that agent's own deployment, provider session, and context. Delegation adds no new event type, no new stored field, and no new table: it reuses the inbound conversation contract, and the task text is stored in CAS exactly like any other conversation content, under the same conversation-scoped privacy.

The delegated event inherits the source event's automation depth plus one, capped at the reviewed bound of eight. A delegated turn therefore cannot lengthen an agent-to-agent chain beyond what [ADR-0395](0395-resumable-native-repository-work-turns.md) already admits, and a chain already at the bound stays there.

Conversation effects are composed before the conversation application opens, while a delegated turn must re-enter through that application. The dispatcher resolves its application handle when it is called rather than when it is wired.

### Failure meaning

Delegation refuses, and dispatches nothing, when the requester is not an admitted effect requester, when the specification is not JSON or does not carry exactly `roleId` and `task`, when no hired agent holds that role, when the agent holding that role does not participate in this conversation, or when the conversation application is not yet open. Each refusal is a bounded error on the requesting turn; none of them synthesizes a turn for an agent that cannot answer it.

## Consequences

A product owner can route work to the specialist it hired without the human naming that specialist, which is the reason for hiring specialists in the first place. Work runs where its context lives instead of in the router's session.

Delegation grants no new authority. The delegated agent answers under its own participation policy, its own effect-request authority, and the same automation bound, so delegation cannot be used to reach an action the delegating agent could not already request, nor to extend a chain past its reviewed depth.

## References

- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
