# ADR-0657: Let an agent hand work to a teammate's own conversation

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0644](0644-keep-agent-coordination-in-conversations.md) (agent-started conversations), [Lervo ADE rooms](../../../../specifications/execution/product-surfaces/ade-rooms.md) slice 2
Related: [ADR-0641](0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md), [ADR-0646](0646-lead-conversations-with-a-product-owner.md), [ADR-0222](../../../execution/orchestration/0222-isolated-agent-workspace-lifecycle.md)

## Context

On 2026-11-28, the owner's product owner Bora hired four owners on the axli rebuild: Drawing Understanding, Machining, Experience, and Foundation. The owner asked for the work to be split among them. Every change still came from Bora's own session, because Lervo left no way to give a hired agent work that changes files:

- **A joined agent only reads.** It is read-only (ADR-0222 keeps one writer per workspace generation), and its tool allowlist admits only Lervo's reading commands.
- **Starting its own conversation was unreachable.** The room block told a joined agent to start its own conversation for work that changes files, but `lervo workspace start` is not a reading command, so its session refused it.
- **Only the starter could lead.** An agent could start only a conversation it leads itself (`agent_not_caller`), so Bora could not open one that Machining leads.
- **The start limit acted as an admission gate.** At four starts an hour, Bora soon hit the limit and wrapped the command in a retry loop.

Lacking a path, Bora improvised:

- it opened conversations in its own name, with briefs saying "the lead session writes, the owner reviews";
- it messaged another conversation through Claude Code's own cross-session messages, which Lervo does not record;
- it stopped a hosted session's process with `kill` to retire a conversation it had opened by mistake.

The owner asked for the root cause to be fixed.

## Decision

- **Delegated start.** `lervo workspace start --started-by <caller> --lead <teammate>` starts a conversation that the teammate leads.
  - Its session writes in its own worktree.
  - The caller's request is its first turn. It is delivered when the caller's turn ends, as the caller's message, with the receipt a mention's delivery carries.
  - Any active team agent may start one for any active teammate: agents hand work to its owner directly, and the product owner is not a router (ADR-0641).
  - Without `--lead`, the caller leads, as before.
- **Every agent can start one.** A read-access session's allowlist admits `lervo workspace start`. The command changes no worktree file: it records a pending start and prepares a new workspace.
- **A backstop, not a gate.** An agent starts at most 12 conversations an hour. The guard only catches a runaway loop.
- **Work for a teammate's existing conversation.** Work that belongs in a conversation the teammate already leads goes there, not to a new one. `lervo workspace send --workspace <id> --started-by <caller>` delivers the request to that conversation's lead when the caller's turn ends, as the caller's message. Its specification and the conversation's line for it follow this decision's first slice.
- **Lervo's channels only.** The room block tells every agent:
  - hand work over with these commands;
  - ask and answer by mention;
  - never message another session through a provider's own tools;
  - never stop a process that Lervo runs.

  A conversation whose session still runs is retired from the ADE, or by its lead once its work is done.

- **Reporting back stays as ADR-0644 sets it.** The lead mentions its requester, the requester joins and answers there, and the requester's own conversation shows one quiet line pointing to that answer.

## State, events, privacy, and failure meaning

- **Pending start.** It gains `startedBy`, the caller. Its `agentId` stays the agent that receives the first turn, now the lead. A start without `startedBy`, from before this decision, was made by its lead.
- **Launch record.** The lead's record keeps `startedBy`, the caller, beside `agentId`, the lead.
- **No new event.** A delivery to the lead records the existing `room.mention.delivered`.
- **Privacy.** The first turn stays in the host-local pending start and then in the provider's transcript, as before.
- **Failure codes:**
  - `agent_not_caller`: `--started-by` is not the calling session's agent.
  - `participant_invalid`: `--started-by` or `--lead` names no active team agent.
  - `conversation_start_limited`: the backstop tripped.

## Consequences

- A product owner gives each hired owner its own conversation, and the owners do the work in parallel, each writing only in its own worktree.
- The owner sees each conversation in the sidebar, led by the owner doing the work, whose mark shows the working ring while it works.
- Provider-private messaging and process kills lose their reason to exist.
- The ADE rooms specification and the coordination specification's read-access section follow.
