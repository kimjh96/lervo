# Lervo ADE rooms

Status: `proposed`
As of: 2026-11-27

This specification defines S2g of [ADR-0637](../../../decisions/execution/applications/0637-build-projects-agents-and-conversations-in-the-ade-on-the-core.md): conversations where agents mention each other and the owner watches them work together. It implements [ADR-0641](../../../decisions/coordination/conversations/agent-organization/0641-let-agents-mention-each-other-in-core-rooms-and-keep-their-own-context.md) as amended by [ADR-0644](../../../decisions/coordination/conversations/agent-organization/0644-keep-agent-coordination-in-conversations.md). There is no team room; a mention stays in the conversation where it was made. The owner approved the interface on 2026-11-26 (mockup "Lervo ADE · 에이전트끼리 멘션하는 대화 (S2g)").

Agents mention each other directly, choosing by role and by what each has learned. The product owner is not a router: an agent mentions it only when its role, priorities and decisions, is needed.

## Delivery

| Slice | Delivers                                                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Mentions inside a conversation: each participant's own session, the owner's and agents' mentions, joining by mention, one timeline with speaker lines, and the exchange budget. |
| 2     | Mentions across conversations, the quiet line in the mentioned agent's own conversation, and conversations an agent starts.                                                     |
| 3     | Memory from conversation: a note after each published turn, and the roster each session sees naming what each agent knows.                                                      |

## Participants and their sessions

- A conversation is a workspace with participants ([Lervo ADE agents](ade-agents.md), "Participants and sessions"). The first participant leads: its session writes in the worktree. Every other participant gets its own hosted session in the same worktree when it is first addressed, with read access only. Writing beyond the lead waits for S2h's claims.
- Rooms need the native conversation mode, where the core decodes each session's output. A conversation in terminal mode keeps one agent.
- An agent's session carries its identity (`LERVO_AGENT_ID`) and its own context, so each agent answers from what it has seen and learned rather than from a shared transcript.
- Each participant's session has its own hosted launch record, with `agentId` and, for an agent that joined, `access: read`. The lead's record alone continues the conversation, so a joined agent's newer record never reopens as the conversation. `workspace.list` reports `participants`, those the conversation started with and then those who joined, and `sessions`, each with `agentId`, `sessionId`, and `access`, the lead's first. A conversation holds at most 16 agents.

## Routing

- **The owner's turn.** A turn that mentions agents goes to each mentioned agent. Any other turn goes to the lead. A mentioned agent that is not a participant joins first.
- **An agent's turn.** When an agent's turn ends, the core reads its final message for mentions. Each mentioned agent receives one turn: who mentioned it, the message, and the conversation's turns since that agent last spoke, at most 8 turns and 16 KiB. A mentioned agent that is not a participant joins first.
- **Replies.** The answer to an agent's mention returns to the agent that mentioned, as a turn, even when the answer mentions no one. Naming the agent that asked is the answer to it, never a new question back. A turn that first asks another agent keeps the answer owed, and the agent's next turn that asks no one answers everyone still waiting. An owner's mention needs no return.
- **A busy agent.** A delivery to an agent whose turn is running waits and goes when that turn ends, in the order the deliveries were made.
- **What a mention is.** `@` followed by the display name of an active team agent of the project, matched without regard to case, at a word boundary, outside code spans and code blocks. Any other `@` text stays text. Lervo's own agents are never mentioned.
- **Bounds.** Agent-to-agent deliveries in one conversation are bounded by ADR-0454's exchange budget, 12 in 10 minutes, and by a depth of 8 from the turn that started the chain. An owner turn resets both. When a bound is reached:
  - the conversation shows that agents paused;
  - the agent that started the exchange receives one more turn, to summarize it;
  - whatever is left open becomes a decision for the product owner, or Lervo debt when no product owner is hired, and never waits on the owner.

## What each session knows

- At its start and at each turn, Lervo's hook context gives the session a room block:
  - who it is;
  - the conversation's participants;
  - the project's team agents with their roles;
  - how a mention works: write `@Name` when the work needs that agent's role or knowledge, and its answer comes back as a turn.
- From slice 3, the block also says what each agent knows, from its notes and expertise, so an agent can pick "the researcher who studied this API last week" by name.

## The core link and the session host

The resident core decodes every hosted session's output, so it sees each turn end without a new channel. Deliveries ride the decoder's answers, and the session host performs them.

- **Deliveries.** `decoder.decoded` gains `deliveries`, each with:
  - `deliveryId`;
  - `workspaceId`;
  - `agentId`;
  - `sessionId`, which is null when the agent has no session yet;
  - `text`.

  For each delivery, the session host:
  1. Opens the agent's session if it has none, from the launch that `room.join` prepares.
  2. Queues the text behind a running turn.
  3. Encodes the text through `decoder.send` and writes it to the session.
  4. Answers `room.delivered` with the `deliveryId`, or `room.failed` with the `deliveryId` and a code.

- **Joining.** `room.join` (`workspaceId`, `agentId`) prepares a read-access launch for an agent in the conversation's worktree, records it in the launch record's `sessions`, and returns the launch.
- **The owner's turn.** `room.route` (`workspaceId`, `text`) answers the agent IDs the turn goes to, in order: the mentioned agents, or the lead. The ADE sends the turn to each through `session.send`, as it sends one today, joining first where needed.
- **Echoes.** A delivered turn reaches the recipient's stream as its user message. The core's decoder for that session knows the delivery it encoded and decodes the echo as a `peer_message` whose `from` is the mentioning agent's display name, never as the owner's message.
- **Room lines.** The core adds `lervo_notice` items to the conversation for what the room does:
  - `room_joined`, with the agent and who mentioned it;
  - `room_paused`, with the turn count and limit;
  - `room_delivery_failed`, with the agent and a code.
- **Advertising.** The core advertises `room.route`, `room.join`, and `decoder.deliveries`. The session host and the ADE use none of them with a core that does not, and an older ADE sees one-agent conversations as before.

## The ADE

- **One timeline.** The conversation opens every participant's session and shows their items in one timeline, ordered by `createdAtMs`. A `peer_message` that a delivery produced does not show, because the mentioning message it repeats already does. The owner's turn sent to several agents shows once.
- **Speakers.** When the speaking agent changes, a line with its mark, name, and role precedes its turn. A conversation with one agent looks as it does today. Marks appear only where an agent is named, speaks, or works (ADE craft rules, 20).
- **Mentions.** A mention of a team agent, in the owner's turn or an agent's, shows as a quiet pill: the name in the link color on a faint accent fill, a step heavier than the text, exactly where the core would deliver it. Other `@` text stays text. Room lines read as quiet lines without a mark: "Arin joined · mentioned by Ciel", "Agents paused after 12 turns in 10 minutes", and "Lervo could not deliver Ciel's mention to Tarin (agent_suspended)".
- **The header** shows the participants' marks, the lead first, and gains a mark when an agent joins.
- **The working line** keeps one row. In a conversation of several agents at work, it names each working agent and what it does, such as "Ciel · Editing retry.ts, Arin · Reading"; with the lead alone at work, it reads as before.
- **The owner's mentions.** Typing `@` in the reply card offers suggestions above the card, at the caret's left, while the field keeps the focus: the conversation's participants first, then the other team agents, "joins when mentioned". Typing narrows the list, Up and Down move, Return or Tab chooses, and Escape closes it. Choosing writes `@Name `, and every mention in the field shows as the same pill as in the conversation, drawn behind the field's own text so the caret and the selection stay the field's.

## Across conversations and agent-started conversations (slice 2)

- **Mentioning across conversations.** A mentioned agent that works in another conversation joins this one with a new session here; its session there continues undisturbed. Its own conversation gains one quiet line, "Ciel answered Iris in Log format", which opens the answer.
- **Agent-started conversations.** An agent starts a conversation with `workspace.start` and `startedBy` set to its agent ID, leading it. The sidebar lists it like any other conversation, and its first turn shows who started it.

## Memory from conversation (slice 3)

- After each turn an agent publishes in a conversation, the agent records a `conversation_note`, its own summary of what it committed to, learned, or decided, as ADR-0454 defines:
  - at most 512 characters;
  - agent-scoped and non-canonical;
  - expires after 30 days.

  The agent context event schema gains this kind before any writer emits it.

- Reviewed decisions and feedback reach the agent's expertise layer through the knowledge resident, as ADR-0641 sets. The room block reads both.

## State, events, privacy, and failure meaning

- **State.** Rooms keep host-local operational state beside the hosted launch records:
  - the launch record's `sessions`;
  - a mention log per conversation, at most 512 entries with the oldest dropped. Each entry holds `mentionId`, `deliveryId`, the mentioning agent or the owner, the mentioned agent, the depth, the state, and the times.

  Message text stays in the providers' transcripts. The mention log holds no text.

- **Events.** Each carries identifiers, counts, and times only, never message text. A session appears only as `providerSessionDigest`, the digest the hosted session events carry, so its UUID stays on the host. They need event schema 15; readers ship first, and the [payload contracts](../events-and-privacy/event-envelope-compatibility.md) define each:
  - `room.participant.joined`: `workspaceId`, `agentId`, `providerSessionDigest`, `mentionedBy` (an agent ID or `owner`), `occurredAt`.
  - `room.mention.recorded`: `workspaceId`, `mentionId` (`mnt_` and 24 hex digits), `fromAgentId` (or null for the owner), `toAgentId`, `depth` (0 to 8), `occurredAt`.
  - `room.mention.delivered`: `mentionId`, `providerSessionDigest`, `occurredAt`.
  - `room.mention.failed`: `mentionId`, `code`, `occurredAt`.
  - `room.exchange.paused`: `workspaceId`, `agentTurnCount`, `limit`, `openerAgentId` (or null when the core saw no owner turn open the exchange), `occurredAt`. The chain stopped and nothing was lost.
- **Failures.** A mention that cannot be delivered shows as a room line and as attention, and is never retried silently.

| Code                       | Meaning                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `mention_target_inactive`  | The mentioned agent is suspended or retired.                                           |
| `room_session_unavailable` | The agent's session could not start, such as when no one is signed in to its provider. |
| `room_delivery_failed`     | The session host could not write the turn to the agent's session.                      |
| `exchange_paused`          | The exchange budget or depth bound stopped the chain.                                  |

- A mention grants no repository authority. Work a mention asks for runs under the mentioned agent's own assignment and lease.

## Channels (later)

Channels may later group conversations by topic, as Discord channels group threads. They organize conversations and are not rooms for agents (ADR-0644). Nothing in S2g waits for them.

## Open items

- Whether a read-access participant may run the conversation's tests, which write only build output, before S2h's claims.
- How long a joined agent's session stays open after its last turn before the session host stops it.
