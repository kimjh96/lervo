# ADR-0646: Lead conversations with a product owner

Status: `accepted`
Decision date: 2026-11-27
Amends: [ADR-0641](0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md) (a conversation's default agent is a product owner, hired when the team has none)
Related: [ADR-0643](../../../execution/orchestration/0643-record-which-agents-are-lervos-own.md), [ADR-0644](0644-keep-agent-coordination-in-conversations.md)

## Context

ADR-0641 made the product owner a new conversation's default agent when one is hired, "otherwise a developer". Onboarding hires a developer as a project's first agent, so in practice every new project's conversations started with a developer leading them. On 2026-11-27 the owner asked what happens in a project without agents and decided: not a developer, a product owner.

The product owner holds priorities and decisions and hires what the work needs (ADR-0454's natural staffing). It is also the agent the others mention for decisions, so a conversation led by it reaches the right roles without the owner staffing it first.

## Decision

- A new conversation's default agent is the team's product owner.
- In a team without one, the start card proposes a Product Owner that Lervo hires. The proposal names the role, not an agent, and leads unless the person chooses other agents instead. When the work starts, Lervo hires the Product Owner through `agent.hire`. The hired agent takes the proposal's place among the participants and appears in the sidebar.
- A hire that fails drops the proposal. The work starts with the other chosen agents, or without an agent, rather than waiting.
- Onboarding still hires a developer as a project's first agent; the knowledge stages use it.

## State, events, privacy, and failure meaning

This decision adds no state or event. The hire records the existing `agent.registered` event with `origin: team`, as any hire of the owner's does. The proposal exists only on the start card until the work starts.

## Consequences

- Every new conversation can mention agents from its first turn, because a product owner leads it.
- A project gains its product owner from its first conversation, without the owner hiring one first.
