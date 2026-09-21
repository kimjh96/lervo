# ADR-0408: Conversation task delegation to hired agents

- Status: accepted
- Decision date: 2026-09-16

## Context

A product owner hires specialist agents into a conversation; each accumulates its own provider session, deployment, and repository context. [ADR-0394](0394-webhook-backed-discord-agent-identities.md) gives them distinct speaking identities, and [ADR-0395](0395-resumable-native-repository-work-turns.md) requires a separately deployed child to receive work through its own deployment.

These capabilities were not connected to the requesting agent's turn. When an owner requested work belonging to a hired specialist, the product owner performed it in its own session, leaving the specialist's context unused. Reaching the specialist required the human to address it explicitly and retain routing knowledge.

[ADR-0391](0391-deterministic-multi-agent-turn-ownership.md) already selects a turn owner from exact participant and role mentions before evaluating relevance. Delegation needs that ownership ladder, which was previously unreachable from inside a turn.

## Decision

### Delegation as a conversation surface effect

A conversation deployment with peer agents also deploys the `workforce_task_delegate` surface effect. Its canonical argument is compact JSON containing exactly `participantId` and `task`, at most 1,024 characters. The deployed effect lists the exact routable participant, role, and reviewed display name coordinates, so two agents with the same role remain independently addressable. The former `roleId` selector remains accepted only as an unambiguous compatibility input and is never generated for new turns. The `task` is the coordinator-authored, natural bounded subtask in the conversation language. It is delivered unchanged except for surrounding transport addressing. Lervo does not prepend a synthetic persona, “delegated agent” identity, original-request label, or instruction to take over the whole outcome.

The complete human outcome remains in the coordinator's prior-turn context. The coordinator chooses direct work, a bounded surface action, delegation, clarification, or an answer from its durable role, context, available capabilities, and responsibility for that outcome. Delegation is neither restricted to a requester naming a peer nor forced whenever a canned scenario matches. It is appropriate when an exact peer's durable role, context, or knowledge makes one subtask useful. The coordinator reconciles the result and retains every unassigned condition and follow-up. This separates task transport from outcome ownership instead of making the worker impersonate a generic assigned persona.

Hiring is reserved for a genuinely new agent identity. If the requested display name already belongs to a routed conversation peer, hiring fails before workforce or Discord mutation and reports that peer's exact `participantId`. It never guesses identity from the name and never creates a same-name webhook as a shadow for an existing app bot or authorized webhook speaker; the caller must delegate to the existing exact participant or choose a distinct new identity.

Reconciliation also checks durable identity before any Discord mutation. When the hired `agentId` already has an application-bot deployment in the requested conversation, that deployment is rebound and reused with no webhook creation. An existing deployment outside the conversation fails closed. A webhook is created only when neither an exact deployment nor an owner record exists for the genuinely new agent.

The effect is deployed only when peer agents exist, so deployments without hired agents do not offer it.

### Delegation re-enters the conversation as an addressed turn

Delegation dispatches one inbound `message.created` event into the same conversation and thread when the target runtime is co-resident. For an explicitly bound peer on another Node, it publishes one eligible message using the peer's exact bot mention or reviewed webhook display address. In both cases the event is authored by the delegating agent and addressed to the target participant. The existing ownership ladder selects the hired agent, whose turn runs in its own deployment, provider session, and context.

Delegation reuses the inbound conversation contract and adds two coordination kinds rather than a new event type or table. `task.assignment` requires `taskId` and `coordinatorParticipantId`; the receiver's verified response carries `task.result` with the same fields. The task ID is an opaque content-derived coordination identifier, and the participant is an existing durable conversation identity. Neither field contains message text, credentials, provider output, or repository content. Task text remains in CAS like other conversation content under the same conversation-scoped privacy.

On Discord, the outbound nonce authenticates the assignment or result kind and opaque task ID. An assignment derives its coordinator from the authenticated author and its target from the exact leading peer address. A result derives its coordinator from the referenced authenticated bot message. Missing, unmapped, malformed, or conflicting coordinates are ignored before ordinary semantic participation. The coordinator alone owns a valid result, reconciles it against the complete original human outcome retained in prior turns, and either advances the concrete authorized next action or gives one concise terminal synthesis. Ordinary agent acknowledgement replies still do not create an address or reply loop.

The natural-discussion ownership evaluator is not a global coordination gate. It abstains from `task.assignment` and `task.result`, allowing the delegated-task rules above to run. This keeps protocols independently extensible and prevents adding one authenticated coordination kind from causing another protocol to classify it as `turn_not_owned`.

The delegated event inherits the source event's automation depth plus one, capped at the reviewed bound of eight. It cannot extend an agent-to-agent chain beyond what [ADR-0395](0395-resumable-native-repository-work-turns.md) admits; a chain already at the bound stays there.

Conversation effects are composed before the conversation application opens, but delegated turns must re-enter through that application. The dispatcher therefore resolves its application handle when called, not when wired.

### Failure meaning

Delegation refuses and dispatches nothing when:

- The requester is not an admitted effect requester.
- The specification is not JSON or does not contain `task` plus exactly one `participantId` or compatibility `roleId` target.
- A compatibility `roleId` matches zero or multiple peers; a current turn must use the exact `participantId`.
- No hired agent holds the role.
- The agent holding the role does not participate in this conversation.
- A co-resident conversation application is not yet open, or a remote peer has no exact reviewed Discord address.
- The selected natural subtask cannot fit the bounded delegation contract.
- A coordinated assignment or result cannot authenticate its exact target or coordinator.

Each refusal is a bounded error on the requesting turn; none synthesizes a turn for an agent that cannot answer it.

## Consequences

A product owner can route work to its hired specialist without the human naming that specialist. Work runs where its context lives instead of in the router's session.

The delegating agent remains responsible for the requested outcome. A peer's status report is evidence for the coordinator, not automatic completion; an incomplete result can produce one further bounded delegated action without requiring the person to restate the request.

Delegation grants no new authority. The delegated agent answers under its own participation policy, its own effect-request authority, and the same automation bound. Delegation cannot reach an action the delegating agent could not already request or extend a chain beyond its reviewed depth.

## References

- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
