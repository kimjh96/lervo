# ADR-0408: Conversation task delegation to hired agents

- Status: accepted
- Decision date: 2026-09-16
- Amended by: [ADR-0454](agent-organization/0454-open-multi-responder-rooms-and-natural-staffing.md)

## Context

A product owner hires conversation specialists, each with its own provider session, deployment, and repository context. [ADR-0394](0394-webhook-backed-discord-agent-identities.md) gives them distinct speaking identities; [ADR-0395](0395-resumable-native-repository-work-turns.md) requires a separately deployed child to receive work through its own deployment.

These capabilities were disconnected from the requesting agent's turn. Product owners performed specialist work in their own sessions, leaving specialist context unused unless the human explicitly addressed the specialist and retained routing knowledge.

[ADR-0391](0391-deterministic-multi-agent-turn-ownership.md) selects turn ownership from exact participant and role mentions before relevance. Delegation needs this ownership ladder, previously unreachable from inside a turn.

## Decision

### Delegation as a conversation surface effect

A conversation deployment with peer agents also deploys `workforce_task_delegate`. Its canonical argument is compact JSON containing exactly `participantId` and `task`, at most 1,024 characters. The deployed effect lists exact routable participant, role, and reviewed display-name coordinates, keeping same-role agents independently addressable. The former `roleId` selector is accepted only as unambiguous compatibility input and is never generated for new turns.

The `task` is a coordinator-authored, natural bounded subtask in the conversation language, delivered unchanged except for surrounding transport addressing. Lervo does not prepend a synthetic persona, “delegated agent” identity, original-request label, or instruction to take over the whole outcome.

The complete human outcome remains in the coordinator's prior-turn context. The coordinator chooses direct work, a bounded surface action, delegation, clarification, or an answer based on its durable role, context, capabilities, and outcome responsibility. Delegation neither requires the requester to name a peer nor becomes mandatory when a canned scenario matches. It is appropriate when an exact peer's durable role, context, or knowledge makes a subtask useful. The coordinator reconciles results and retains every unassigned condition and follow-up. Task transport does not transfer outcome ownership or make the worker impersonate a generic assigned persona.

Hiring is reserved for a genuinely new identity. If the requested display name already belongs to a routed conversation peer, hiring fails before workforce or Discord mutation and reports that peer's exact `participantId`. It never guesses identity from a name or creates a same-name webhook shadowing an existing app bot or authorized webhook speaker. The caller must delegate to the existing exact participant or choose a distinct new identity.

Reconciliation checks durable identity before any Discord mutation. If the hired `agentId` already has an application-bot deployment in the requested conversation, it rebinds and reuses that deployment without creating a webhook. An existing deployment outside the conversation fails closed. A webhook is created only when neither an exact deployment nor an owner record exists for the genuinely new agent.

The effect is deployed only when peer agents exist; deployments without hired agents do not offer it.

### Delegation re-enters the conversation as an addressed turn

For a co-resident target runtime, delegation dispatches one inbound `message.created` event into the same conversation and thread. For an explicitly bound peer on another Node, it publishes one eligible message using the peer's exact bot mention or reviewed webhook display address. In both cases, the delegating agent authors the event and addresses the target participant. The existing ownership ladder selects the hired agent, whose turn uses its own deployment, provider session, and context.

Delegation reuses the inbound conversation contract, adding two coordination kinds without a new event type or table. `task.assignment` requires `taskId` and `coordinatorParticipantId`; the receiver's verified response carries `task.result` with the same fields. The task ID is an opaque content-derived coordination identifier; the participant is an existing durable conversation identity. Neither field contains message text, credentials, provider output, or repository content. Task text remains in CAS under the same conversation-scoped privacy as other conversation content.

On Discord, the outbound nonce authenticates assignment or result kind and opaque task ID. An assignment derives its coordinator from the authenticated author and target from the exact leading peer address. A result derives its coordinator from the referenced authenticated bot message. Missing, unmapped, malformed, or conflicting coordinates are ignored before ordinary semantic participation. Only the coordinator owns a valid result. It reconciles the result against the complete original human outcome retained in prior turns, then advances the concrete authorized next action or gives one concise terminal synthesis. Ordinary agent acknowledgement replies still create neither an address nor a reply loop.

For webhook-backed co-resident speakers, [ADR-0629](delivery/0629-separate-webhook-publication-from-task-control.md) separates visible result publication from the router's authenticated task-result event. Webhook text cannot carry the bot nonce, so remote delegation requires bot identities at both ends and otherwise fails before publication. Exact co-resident hired-agent routing remains intact.

The natural-discussion ownership evaluator is not a global coordination gate. It abstains from `task.assignment` and `task.result` so delegated-task rules can run. Protocols remain independently extensible: adding one authenticated coordination kind must not cause another protocol to classify it as `turn_not_owned`.

The delegated event inherits source automation depth plus one, capped at the reviewed bound of eight. It cannot extend an agent-to-agent chain beyond [ADR-0395](0395-resumable-native-repository-work-turns.md); a chain already at the bound stays there.

Conversation effects are composed before the application opens, but delegated turns must re-enter through that application. The dispatcher therefore resolves its application handle when called, not when wired.

### Failure meaning

Delegation refuses and dispatches nothing when:

- The requester is not an admitted effect requester.
- The specification is not JSON or lacks `task` plus exactly one `participantId` or compatibility `roleId` target.
- A compatibility `roleId` matches zero or multiple peers; a current turn must use exact `participantId`.
- No hired agent holds the role.
- The agent holding the role does not participate in this conversation.
- A co-resident application is not yet open, or a remote peer lacks an exact reviewed Discord address.
- The selected natural subtask cannot fit the bounded delegation contract.
- A coordinated assignment or result cannot authenticate its exact target or coordinator.

Each refusal is a bounded error on the requesting turn. None synthesizes a turn for an agent that cannot answer.

## Consequences

A product owner can route work to a hired specialist without the human naming it. Work runs where the specialist's context lives rather than in the router's session.

The delegating agent remains responsible for the requested outcome. A peer's status report is coordinator evidence, not automatic completion. An incomplete result can produce one further bounded delegated action without requiring the person to restate the request.

Delegation grants no new authority. The delegated agent answers under its own participation policy, its own effect-request authority, and the same automation bound. Delegation cannot reach an action the delegating agent could not already request or extend a chain beyond its reviewed depth.

## References

- [Deterministic multi-agent turn ownership](0391-deterministic-multi-agent-turn-ownership.md)
- [Webhook-backed Discord agent identities](0394-webhook-backed-discord-agent-identities.md)
- [Resumable native repository work turns](0395-resumable-native-repository-work-turns.md)
- [Separate webhook publication from task control](delivery/0629-separate-webhook-publication-from-task-control.md)
