# ADR-0661: Let every member of a conversation work in it from its own worktree

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0641](0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md) (a joined agent reads only), [ADR-0657](0657-let-an-agent-hand-work-to-a-teammates-own-conversation.md) (work inside a topic goes to a new conversation), [Lervo ADE rooms](../../../../specifications/execution/product-surfaces/ade-rooms.md) "Participants and their sessions", [Lervo ADE coordination](../../../../specifications/execution/product-surfaces/ade-coordination.md) "Read-access participants", now "Members of a conversation"
Related: [ADR-0222](../../../execution/orchestration/0222-isolated-agent-workspace-lifecycle.md), [ADR-0644](0644-keep-agent-coordination-in-conversations.md), [ADR-0646](0646-lead-conversations-with-a-product-owner.md)

## Context

On 2026-11-28 the owner worked a whole day in one axli conversation with the product owner Bora and four hired owners. The owner found the collaboration awkward and asked for it to be fixed at the root. The day's records show why:

- **Members could not work where they were asked.** A member that joined by a mention could only read: one writer per workspace generation (ADR-0222) left the lead's worktree to the lead. Every change therefore moved to a separate conversation, and the members said so: "this conversation cannot change files, so I will do it in my Machining conversation".
- **The work scattered.** Seven conversations opened in eight hours. Some were investigations, some small tasks, and one duplicated an open conversation. The owner deleted four of them by hand and asked which was which.
- **Each agent split into copies.** An agent mentioned from another conversation answered there in a new session, without its own context. Bora had a session in every conversation it touched. Owners reported to Bora's copy in their own conversation, so the owner's conversation heard nothing.
- **The owner became the scheduler.** Twelve of the owner's 72 messages asked what was going on. Owners finished, reported to a copy of Bora, and stopped. Bora counted provider processes with `ps` to guess who was working.

The owner's direction, the same day:

- Work happens in the conversation, naturally, as people talk.
- A member reports to whoever needs it: to the agent coordinating, or to the owner directly. The one coordinating keeps the owner informed and raises what the owner must decide.
- Coordination is not vertical, and it is not tied to the product owner role.
- Each member keeps building its own context.
- What the owner does not see, Lervo cleans up on its own.

## Decision

- **Every member writes, from its own worktree.** The first time a teammate receives a turn in a conversation, Lervo prepares a member workspace for it. Its mention or the owner's turn both count.
  - The workspace is a worktree and branch of its own, started from the fetched upstream tip as a conversation's is, with its own coordination: generation record, conversation assignment, growing lease, and claim handler.
  - The member's session in the conversation runs there with write access.
  - The conversation's lead keeps the conversation's own worktree.
  - Claims keep the members' writes apart, as they keep conversations apart, so ADR-0222's one writer per generation holds: each member workspace is a generation with one writer.
- **One conversation, one session per member.** A member's session in the conversation keeps its context for the life of the conversation. Every turn it receives there reaches that same session, and its worktree stays with it.
- **Peers, not a hierarchy.**
  - A member answers whoever asked, in the conversation, and asks the teammate whose role or knowledge it needs directly.
  - The conversation's lead is whoever the owner started it with. The lead keeps the owner informed and raises what the owner must decide. Any member speaks to the owner directly when only the owner can answer.
  - The lead is not a gate. No role, the product owner's included, routes work.
- **Separate conversations for separate topics.** Work inside the conversation's topic goes to a member, by mention, in the conversation. `lervo workspace start`, with or without `--lead`, opens a conversation only for a topic of its own, and `lervo workspace send` reaches a teammate's existing conversation only when the work belongs there.
- **Work meets through Git.**
  - A member commits in its own worktree and seals finished work there with `lervo workspace seal --write`, as a lead does. Sealing and integration treat a member workspace like any conversation's generation.
  - A member reads a teammate's worktree in the conversation but writes only its own. The room block names each member's worktree.
- **Cleanup the owner never sees.**
  - A member workspace lives as long as its conversation. After a seal it continues as the next generation in the same worktree, as a conversation does, so the member's session and context stay with it.
  - Retiring the conversation retires each member workspace first, with the same rules as any retire: uncommitted work is copied before removal, and a sealed change waiting for integration refuses.
  - A member workspace whose worktree vanished is swept by `lervo upgrade` as any conversation's is.
  - The sidebar never lists a member workspace as a conversation. Nothing about it appears in the conversation.
- **Sessions from before this decision.** A member session recorded with read access keeps reading in the lead's worktree until its conversation ends. Its context lives in a provider transcript tied to that directory, and moving it would lose that context. New members write.

## State, events, privacy, and failure meaning

- **Launch record.** A member's hosted launch record carries the member workspace's own `workspaceId` and `branch`, and `room`: the workspace ID of the conversation it belongs to. The record keeps identifiers only, as every launch record does.
  - The conversation's sessions are its lead's records and every record whose `room` names it.
  - A record with `room` never leads, never lists as a conversation, and never counts among the conversations an agent leads.
- **Events.** No new event. Preparing a member workspace records the start's existing `launch_prepared` and coordination events under the member workspace's ID. Retiring it records the existing retire events.
- **Privacy.** Unchanged. The member's first turn reaches its session as a delivery, and its text stays in the provider's transcript, never in a record.
- **Failure meaning.** A member workspace that cannot be prepared fails the join with the start's own codes, such as `workspace_start_failed`, and the delivery waits as a failed join does today. Retiring a conversation stops at the first member workspace that refuses, with that workspace's code and ID, and removes nothing of the conversation itself.

## Consequences

- A conversation becomes the place where the team works: the owner sees every member's work and words in one timeline, and stops asking what is going on.
- A member's context grows in one session per conversation instead of splitting across copies.
- Conversations multiply only with topics. Member workspaces stay out of sight and leave with their conversation.
- The ADE rooms and coordination specifications follow: "Participants and their sessions", the room block, and "Members of a conversation".
