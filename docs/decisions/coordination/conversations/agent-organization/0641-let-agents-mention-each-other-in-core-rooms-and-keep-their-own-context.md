# ADR-0641: Let agents mention each other in core rooms, and keep their own context

Status: `accepted`
Decision date: 2026-11-26
Amended by: [ADR-0644](0644-keep-agent-coordination-in-conversations.md) (no team room; a mention stays in the conversation where it was made), [ADR-0646](0646-lead-conversations-with-a-product-owner.md) (a product owner leads by default, hired when the team has none)
Part of: [ADR-0637](../../../execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)
Related: [ADR-0386](../0386-organization-teams-and-agent-identities.md), [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md), [ADR-0632](../../../execution/applications/0632-build-the-ade-as-the-platform-where-the-core-works.md)

## Context

On 2026-11-26 the owner asked for conversations with participants and mentions, and stressed that mentions matter most between agents: agents should work together by role, mentioning each other as their work needs, because each one accumulates its own context.

ADR-0454 already sets rooms with several responders, open agent turns, an exchange budget, discussions, and memory from conversation. It is accepted but implemented nowhere; the Discord runtime that ADR-0560 kept answers each turn with a single owner and suppresses mentions. ADR-0386 gives each agent a context namespace with identity, work, relationship, and expertise layers. On 2026-11-26 this clone's 13 active agents had no context entries, because ADE sessions carry no agent and nothing attributes their turns.

## Decision

### A conversation is a core room with participants

- A conversation has an ID, its project, its participants (the owner and one or more agents), and its turns.
  - Agent-to-agent turns, mentions, and threads go through the core's identity, assignment, and handoff records ([ADR-0632](../../../execution/applications/0632-build-the-ade-as-the-platform-where-the-core-works.md), foundation 5).
  - The core implements [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md)'s room model as records the ADE reads and the terminal can use. It is built for the core, not ported from the Discord runtime, which never implemented it.
- Creating a conversation chooses its agents. The product owner is the default when one is hired, otherwise a developer.
- Each project has one team room, where its agents coordinate. The sidebar shows the agents and their status, never the room's messages.
- The conversation shows an agent's mark and name when the speaker changes. A conversation with one agent looks as it does today.

### Agents accumulate their own context

- Once a session carries an agent, each turn is attributable to that agent.
- ADR-0454's memory from conversation applies to ADE turns: after each turn an agent publishes, the agent writes a bounded self-summary. The summary is agent-scoped, non-canonical, and expires after 30 days. The agent context event schema gains its memory kind before any writer emits it.
- Reviewed decisions, feedback, and verified improvements reach the agent's expertise layer ([ADR-0386](../0386-organization-teams-and-agent-identities.md)) through the knowledge resident. Unreviewed generated claims stay out.
- Agent records and their context follow the project across hosts only once S2c replicates them. Until then each clone keeps its own.

### Agents mention each other when their work needs it

- An agent mentions another agent when its work needs that agent's role or what that agent has learned, without waiting for the owner. It chooses by role and by accumulated context: the agent whose work and expertise layers hold the matter, such as the researcher who studied an API last week.
- The core delivers a mention as a turn to the mentioned agent and keeps delivery, acknowledgment, action, and verified result distinct. Agent turns are open by default (ADR-0454): an agent in a room may speak without being asked.
- A mention grants no repository authority. Work a mention asks for runs under the mentioned agent's own assignment and lease.
- Exchanges are bounded by ADR-0454's exchange budget and by loop guards. When an exchange reaches its bound, the agent that opened it posts a summary, and anything left open becomes a decision for the product owner or Lervo debt, never a wait on the owner.
- Mentions are how agents' contexts grow apart. The answer and any decision are recorded with the agents involved, as memory from conversation and, once reviewed, as expertise, so the next mention finds the agent who knows.
- The owner sees agents working together in the room where it happens, usually the project's team room, and may join with a mention of their own.

## State, events, privacy, and failure meaning

The S2g specification defines the room, turn, mention, and memory events before they ship, with the conversation note's memory kind added to the agent context event schema before any writer emits it. A mention that cannot be delivered is reported as attention, never retried silently. Message text stays in the room's records under the project's data policy; events carry identifiers and counts.

## Consequences

- Agents work together without the owner relaying between them, and the owner watches it happen.
- Each agent's context grows from the work it did and the questions it answered, so the right agent is found by what it knows.
- The core gains a conversation model that the terminal can use too.
