# ADR-0644: Keep agent coordination in conversations

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0641](0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md) (no team room; a mention stays in the conversation where it was made)
Related: [ADR-0454](0454-open-multi-responder-rooms-and-natural-staffing.md), [ADR-0637](../../../execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md)

## Context

ADR-0641 gave each project one team room, where agents coordinate and where the owner usually watches them work together. When the owner reviewed the mockup on 2026-11-26, they asked why a team room was needed at all: conversations already let agents join, mention each other, and continue naturally. The team room had come from the Discord runtime's project channel, and the ADE's conversations already do its work.

Two cases had seemed to need it:

- coordination between agents working in different conversations, such as two developers who need the same file;
- work that no conversation of the owner's started.

Both fit in conversations.

## Decision

- **No team room.** A project has conversations only.
- **Mentions stay in their conversation.** A mention is delivered in the conversation where it was made. A mentioned agent that is not yet a participant joins that conversation, and the conversation shows it joining.
- **Coordination across conversations.** An agent that needs an agent working in another conversation mentions it from its own conversation. The mentioned agent joins and answers there, and its own conversation records one quiet line pointing to the answer.
- **Agent-started conversations.** Work that no owner conversation started gets a conversation the agent starts itself. The sidebar lists it like any other conversation.
- **Channels later.** Channels may later group conversations by topic, as Discord channels group threads. They are a way to organize conversations, not rooms for agents, and nothing in this decision waits for them.

## State, events, privacy, and failure meaning

This decision removes a planned record (the team room) and adds none. The S2g specification ([Lervo ADE rooms](../../../../specifications/execution/product-surfaces/ade-rooms.md)) defines the participant, mention, and delivery records, their events, and their failures.

## Consequences

- The owner reads agents working together where the work happens, without a second place to watch.
- ADR-0641's acceptance becomes: the conversation where the mention was made shows both turns.
- The roadmap's S2g row and the ADE agents specification follow.
